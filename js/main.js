(function() {
  "use strict";

  /**
   * General-purpose utilities.
   */
  var Util = {
    schedule: function(code, ...args) {
      if (!code) {
        console.error("No code", new Error().stack);
        throw new Error("No code");
      }
      return Promise.all(args).then(args =>
        new Promise((resolve, reject) => {
          for (var arg of args) {
            if (arg && arg instanceof HTMLElement) {
              arg.classList.add("loading");
            }
          }
          window.setTimeout(() => {
            try {
              var result = code(...args);
              resolve(result);
            } catch (ex) {
              console.error(ex);
              reject(ex);
              return;
            } finally {
              for (var arg of args) {
                if (arg && arg instanceof HTMLElement) {
                  arg.classList.remove("loading");
                }
              }
            }
          }, 0);
        })
      );
    },

    fetch: function(base, options, anchor, delay, attempts, message) {
      var url = new URL(base);
      if (!(Array.isArray(options))) {
        options = [options];
      }
      for (var obj of options) {
        for (var k of Object.keys(obj)) {
          url.searchParams.append(k, obj[k]);
        }
      }
      url.hash = anchor;
      return this.rawFetch(url.href, delay, attempts, message);
    },

    rawFetch: function(uri, delay, attempts, message) {
      console.log("Attempting to fetch", uri, "with", attempts, "attempts remaining");
      if (!attempts) {
        return new Promise(resolve => "Too many attempts");
      }

      var xhr = new XMLHttpRequest();
      var result = new Promise((resolve, reject) =>
        xhr.addEventListener("load", function(event) {
          console.log("Fetch", uri, "complete", xhr.status);
          if (xhr.status == 429) {
            status("Server rejected request, we will need to wait");
            var promise = Util.wait(delay, message);
            promise = promise.then(() => Util.rawFetch(uri, delay * 2, attempts
                                             - 1, message));
            promise.then(resolve, reject);
            return;
          }

          try {
            var response = JSON.parse(xhr.response);
            resolve(response);
          } catch (ex) {
            reject(response);
          }
        }));
  
      xhr.open("GET", uri, true);
      xhr.send();
      return result;
    },

    wait: function(ms, message = "") {
      if (ms) {
        var content = "Waiting " + ms + " milliseconds to avoid "
          + "DoS" + message;
        status(content);
      }
      return new Promise(resolve => {
        window.setTimeout(resolve, ms);
      });
    },

    loop: (init, stop, next) => (
      cb =>
        (function aux(acc) {
          return new Promise((resolve, reject) => {
            if (stop(acc)) {
              resolve();
              return;
            }
            var promise = cb(acc);
            promise = promise.then(
              () => aux(next(acc))
            );
            promise.then(resolve, reject);
          });
        })(init)
    ),

    Filter: function() {
      /**
       * Map of product to set of version
       */
      this._byProduct = new Map();
    },

    /**
     * Strict object.
     *
     * Used to catch erroneous calls to `foo.bar` more easily
     * when `bar` doesn't have a property `foo`.
     */
    strict: function(obj = {}) {
      return new Proxy(obj, {
        get: function(target, name) {
          if (name in target) {
            return target[name];
          }
          if (name == "then" || name == "toJSON") {
            // Special case, see bug 1089128
            return undefined;
          }
          var error = new Error("No such key: '" + name + "', expected one of " + JSON.stringify(Object.keys(target)));
          console.error("No such key", name, target, error.stack);
          throw error;
        },
      });
    },

    buildToDate: function(build_id) {
      var [,yy,MM,dd,hh,mm,ss] = /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(build_id);
      var date = new Date();
      date.setUTCFullYear(yy);
      date.setUTCMonth(MM - 1);
      date.setUTCDate(dd);
      date.setUTCHours(hh);
      date.setUTCMinutes(mm);
      date.setUTCSeconds(ss);
      console.log("buildToDate", build_id, date);
      return date;
    },

  };
  Util.Filter.prototype = {
    set: function(product, version, accept) {
      console.log("Installing a filter", product, version, accept);
      if (!product) {
        throw new TypeError("Expected a product");
      }
      if (!version) {
        throw new TypeError("Expected a version");
      }
      var thisProduct = this._byProduct.get(product);
      if (!thisProduct) {
        thisProduct = new Map();
        this._byProduct.set(product, thisProduct);
      }
      thisProduct.set(version, accept);
    },
    get: function(product, version) {
      if (!product) {
        throw new TypeError("Expected a product");
      }
      if (!version) {
        throw new TypeError("Expected a version");
      }
      var thisProduct = this._byProduct.get(product);
      if (!thisProduct) {
        return true;
      }
      return thisProduct.get(version);
    },
    _getAll: function(accept) {
      var result = [];
      for (var [kProduct, vProduct] of this._byProduct) {
        for (var [kVersion, vVersion] of vProduct) {
          if (vVersion == accept) {
            result.push({product: kProduct, version: kVersion});
          }
        }
      }
      return result;
    },
    getRejects: function() {
      return this._getAll(false);
    },
    getAccepts: function() {
      return this._getAll(true);
    },
  };

  var Server = {
    getCount: function() {
      status("Fetching size of sample");
      var promise = Util.fetch(Server.BASE_URI, {
        async_shutdown_timeout: "!__null__",
        _results_number: 1,
      },
      "", 500, 10);
      return promise.then(data => data.total);
    },

    /**
     * Get a sample of data for a given day
     *
     * @param {number} daysAgo A number (>=0)
     * @param {number} sampleSize
     *
     * @return {array} An array of payloads
     */
    getSampleForAge: function(daysAgo, restrict, sampleSize = 100) {
      var date = new Date();
      date.setDate(date.getDate() - daysAgo);
      var isoDay = date.toISOString().substring(0, 10);
      status("Fetching data for " + isoDay);
      date.setDate(date.getDate() + 1);      
      var isoNextDay = date.toISOString().substring(0, 10);

      var options = [
        {
          async_shutdown_timeout: "!__null__",
          _results_number: sampleSize,
        },
        {
          date: ">=" + isoDay
        },
        {
          date: "<" + isoNextDay
        }
      ];


      restrict.versions.forEach(v => {
        var [product, version] = v.split(" ");
        if (product && version) {
          options.push({version: version}); // Versions are OR-ed by the server
        }
      });

      restrict.signatures.forEach(sig => {
        var operator, content;
        if (!sig) {
          return;
        }
        if (sig.startsWith("~!")) {
          throw new Error("Negative matches are not supported yet (by the server?)");
        } else if (sig.startsWith("~")) {
          operator = "";
          content = sig.substring(1);
        } else {
          throw new Error("Operator not supported: " + sig);
        }
        options.push({async_shutdown_timeout: operator + content});
      });

      return Util.fetch(Server.BASE_URI, options, "", 1000, 5);
    },

    BASE_URI: "https://crash-stats.allizom.org/api/SuperSearch/",

  };

  var View = {
    status: function(msg) {
      console.log("Status", msg);
      $("status").textContent = msg;
    },

    prepareHistogram: function(eStatistics, rectangles, key) {
      var eCanvas = document.createElement("canvas");
      eStatistics.appendChild(eCanvas);
      var context = eCanvas.getContext("2d");

      const WIDTH = 300;
      const HEIGHT = 300;
      eCanvas.width = WIDTH;
      eCanvas.height = HEIGHT;
      eCanvas.style.width = WIDTH + "px";
      eCanvas.style.height = HEIGHT + "px";
      rectangles.length = 0;

      // Handle tooltip
      var delayedMouseMove = null;
      eCanvas.addEventListener("mousemove", function(event) {
        if (delayedMouseMove) {
          window.clearTimeout(delayedMouseMove);
        }
        delayedMouseMove = window.setTimeout(function() {
          delayedMouseMove = null;
          var bounds = eCanvas.getBoundingClientRect();
          var x = event.clientX - bounds.left;
          var y = event.clientY - bounds.top;

          for (var [x0, y0, w, h, name] of rectangles) {
            if (x >= x0 && y >= y0 && x < x + w && y < y + h) {
              eCanvas.title = name;
              return;
            }
          }
        });
        window.setTimeout(delayedMouseMove, 5);
      });
      return context;
    },

    updateHistogramByDay: function(context, key, allDays, factor) {
      const WIDTH = 300;
      const HEIGHT = 300;
      const DAYS_BACK = allDays.length;
      context.fillStyle = "white";
      context.fillRect(0, 0, WIDTH, HEIGHT);

      var rectangles = this._elements.get(key).histogramsByDay;
      rectangles.length = 0;

      // Determine max
      var max = 0;
      allDays.forEach((byDay, i) => {
        var byKey = byDay.signatures.byKey;
        if (!byKey.has(key)) {
          // No such crash on that day
          return;
        }
        var byVersion = byKey.get(key).byVersion;
        if (byVersion.total > max) {
          max = byVersion.total;
        }
      });
      if (max == 0) {
        // Histogram is empty
        return;
      }

      // Display rectangles
      // FIXME: Add build information
      const H = HEIGHT/max;
      const W = WIDTH/DAYS_BACK;
      allDays.forEach((byDay, age) => {
        var x0 = WIDTH - W * (age + 1);
        var y0 = HEIGHT;
        var byKey = byDay.signatures.byKey;
        if (!byKey.has(key)) {
          // No such crash on that day
          return;
        }
        var byVersion = byKey.get(key).byVersion;

        byVersion.sorted.forEach((v, i) => {
          var [key, hits] = v;
          var height = hits.length * H;
          y0 = y0 - height;
          context.fillStyle = View._colors.get(key);
          context.fillRect(x0, y0, W, height);
          rectangles.push([x0, y0, W, height, key + " (est. " + Math.ceil(hits.length * factor) + " crashes)"]);
        });

        // Extract Nightly values
        var [_, hits] = byVersion.sorted[0];
        var nightlies = 0;
        var thatDay = new Date();
        thatDay.setDate(thatDay.getDate() - age);
        console.log("Extracting nightlies for", thatDay);
        hits.forEach(v => {
          if (v.release_channel != "nightly") {
            return;
          }
          var build_id = v.build_id;
          var year = Number.parseInt(build_id.substring(0, 4));
          var month = Number.parseInt(build_id.substring(4, 6));
          var day = Number.parseInt(build_id.substring(6, 8));
          var date = new Date();
          date.setYear = year;
          date.setMonth = month - 1;
          date.setDate = day;
          console.log("Nightly build", date, "we'd like", thatDay);
          if (thatDay.getDate() != day) {
            console.log("Wrong day", thatDay.getDate(), day);
            return;
          }
          if (thatDay.getMonth() != month) {
            console.log("Wrong month", thatDay.getMonth(), month);
            return;
          }
          if (thatDay.getYear() != year) {
            console.log("Wrong year", thatDay.getYear(), year);
            return;
          }
          nightlies++;
          console.log("Nightly", nightlies);
        });
      });

      // Display Nightly values
      

      // Display time graduations
      context.fillStyle = "black";
      for (var i = 0; i < DAYS_BACK; ++i) {
        context.fillText("-" + i + "d", WIDTH - W * (i + 1), HEIGHT - 10);
      }
    },
    updateAllHistograms: function(allData, factor) {
      for (var [k, v] of this._elements) {
        this.updateHistogramByDay(v.contextByDay, k, allData, factor);
      }
    },

    updateBuildInformation: function(eBuilds, key, allDays) {
      var versions = new Map();
      // Fold build information from all days
      allDays.forEach((byDay, age) => {
        var byKey = byDay.signatures.byKey;
        if (!byKey.has(key)) {
          // No such crash on that day
          return;
        }
        var byVersion = byKey.get(key).byVersion;
        [...byVersion.builds].forEach(v => {
          var [version, builds] = v;
          var thisVersion = versions.get(version);
          if (!thisVersion) {
            thisVersion = Util.strict({
              minBuild: null,
              maxBuild: null,
            });
            versions.set(version, thisVersion);
          }
          if (thisVersion.minBuild == null || thisVersion.minBuild > builds.minBuild) {
            thisVersion.minBuild = builds.minBuild;
          }
          if (thisVersion.maxBuild == null || thisVersion.maxBuild < builds.maxBuild) {
            thisVersion.maxBuild = builds.maxBuild;
          }
        });
      });
      // Now display stuff
      eBuilds.innerHTML = "";
      var builds = [...versions].sort((x, y) => x[0] < y[0]);
      builds.forEach(v => {
        var [version, {minBuild, maxBuild}] = v;
        var minDate = Util.buildToDate(minBuild).toDateString();
        var maxDate = Util.buildToDate(maxBuild).toDateString();
        var li = document.createElement("li");

        var eVersion = document.createElement("span");
        eVersion.textContent = version + " ";
        eVersion.style.color = View._colors.get(version);
        li.appendChild(eVersion);

        var eDates = document.createElement("span");
        if (minDate == maxDate) {
          eDates.textContent = minDate;
        } else {
          eDates.textContent = minDate + " to " + maxDate;
        }
        li.appendChild(eDates);

        eBuilds.appendChild(li);
      });
    },

    updateAllBuildInformation: function(allData) {
      for (var [k, v] of this._elements) {
        this.updateBuildInformation(v.eBuilds, k, allData);
      }
    },

    updateAllLinks: function(allData) {
      const MAX_LINKS_PER_DAY = 20;

      allData.forEach((oneDay, age) => {
        var title = age + " days ago ";

        oneDay.signatures.sorted.forEach(kv => {
          var [kind, signature] = kv;

          var eLinks = this._elements.get(kind).eLinks;
          var children = [...eLinks.children];

          var eSingleDay;
          eSingleDay = children.find(x => x.getAttribute("_dashboard_ago") == "" + age);
          if (signature.length > 0) {
            console.log("We have links for", kind, age, signature);
            if (eSingleDay) {
              eSingleDay.innerHTML = "";
            } else {
              eSingleDay = document.createElement("li");
              eSingleDay.setAttribute("_dashboard_ago", age);
            }
          } else {
            console.log("NO links for", kind, age, signature);
            if (eSingleDay) {
              eLinks.removeChild(eSingleDay);
            }
            return;
          }
          eSingleDay.textContent = title;
          eLinks.appendChild(eSingleDay);

          var eDayLinks = document.createElement("ul");
          eSingleDay.appendChild(eDayLinks);

          var linksInDay = 0;
          var ENOUGH = new Error("Enough samples, bailing out");
          try {
            signature.forEach(hit => {
              var eSampleLi = document.createElement("li");
              eDayLinks.appendChild(eSampleLi);

              if (linksInDay++ >= MAX_LINKS_PER_DAY) {
                eSampleLi.textContent = "[...] (omitted " +
                  (signature.length - MAX_LINKS_PER_DAY) + ")";
                throw ENOUGH;
            }


              var eLink = document.createElement("a");
              eSampleLi.appendChild(eLink);
              eLink.href = "https://crash-stats.mozilla.com/report/index/" + hit.uuid;
              var version = hit.product + " " + hit.version;
              if (hit.release_channel == "nightly") {
                version += " " + hit.build_id;
              }
              eLink.textContent = hit.uuid + " (" +  version + ")";


              eSampleLi.title = JSON.stringify(hit.annotation, null, "\t");
            });
          } catch (ex if ex == ENOUGH) {
            // Ok, we just bailed out
          }
        });
      });
    },

    showStacks: function(crash, eStacks) {
      status("Preparing stacks");
      eStacks.textContent = "No report contained a valid stack";
      
      // Search a sample with a stack
      var found = false;
      for (var sample of crash.data.all) {
        var condition = sample.conditions[0];
        if (!condition || typeof condition != "object") {
          console.error("The following condition is problematic", crash,
            crash.data);
        }
        if (condition && !("stack" in condition)) {
          continue;
        }
        console.log("Found a stack");
        eStacks.textContent = "";

        for (condition of sample.conditions) {
          var eSingleStack = document.createElement("div");
          eSingleStack.classList.add("stack");
          eStacks.appendChild(eSingleStack);

          var eStackHeader = document.createElement("div");
          eStackHeader.classList.add("stackHeader");
          eStackHeader.textContent = condition.name;
          eSingleStack.appendChild(eStackHeader);

          var eStackList = document.createElement("ol");
          eSingleStack.appendChild(eStackList);

          for (var frame of condition.stack) {
            var eStackFrame = document.createelement("li");
            eStackFrame.textContent = frame;
            eStackList.appendChild(eStackFrame);
          }
        }

        return;
      }
    },

    // Grab the list of all versions involved
    _colors: null,
    setupColors: function(versions, displayWithFilter) {
      if (this._colors) {
        return; // Nothing to do
      }
      this._colors = new Map();

      var updateDisplayTimeout = null;

      var eVersions = $("Versions");
      eVersions.innerHTML = "";
      var eColors = document.createElement("ul");
      eVersions.appendChild(eColors);

      var boxToVersion = new Map();

      var filterArgs = new URL(window.location).searchParams.getAll("version");
      console.log("setupColors", "filterArgs", filterArgs);
      versions.forEach((v, i) => {
        var {product, version} = v;
        var description = product + " " + version;
        var color = "rgba(" + Math.floor(255 * ( 1 - i / versions.length ) ) + ", 100, 100, 1)";
        View._colors.set(description, color);

        var eSingleColor = document.createElement("li");
        eColors.appendChild(eSingleColor);
        eSingleColor.textContent = description;
        eSingleColor.style.color = color;

        var eCheckBox = document.createElement("input");
        eCheckBox.type = "checkbox";
        eSingleColor.appendChild(eCheckBox);
        boxToVersion.set(eCheckBox, v);

        if (filterArgs.length == 0 || filterArgs.some(x => {
            console.log("setupColors", "comparing", x, description);
            return x == description;
        })) {
          eCheckBox.checked = "checked";
        }

        eCheckBox.addEventListener("change", (v => event => {
          if (updateDisplayTimeout) {
            // Delay timeout by a few milliseconds
            window.clearTimeout(updateDisplayTimeout);
            updateDisplayTimeout = null;
          }
          updateDisplayTimeout = window.setTimeout(function() {
            Util.schedule(() => {
              console.log("setupColors", "User requested a display update");
              updateDisplayTimeout = null;
              var filter = new Util.Filter();
              var newURL = new URL(window.location);
              var newArgs = newURL.searchParams;
              newArgs.delete("version");

              for (var [box, {product, version}] of boxToVersion) {
                console.log("setupColors", "adding to filter", product, version, box.checked);
                filter.set(product, version, box.checked);
                if (box.checked) {
                  newArgs.append("version", product + " " + version);
                }
              }

              var eGoto = $("Goto");
              eGoto.href = newURL;
              eGoto.classList.remove("hidden");
              Util.schedule(displayWithFilter, filter);
            });
          }, 500);

        })(v));
      });

      var eClearLi = document.createElement("li");
      eVersions.appendChild(eClearLi);
    },


    _elements: new Map(),
    prepareSignatureForDisplay: function(key, daysBack) {
      if (this._elements.has(key)) {
        return this._elements.get(key);
      }

      var elements = {};
      var eResults = $("Results");

      var eCrash = document.createElement("div");
      eCrash.classList.add("crash");
      eResults.appendChild(eCrash);
      elements.eCrash = eCrash;

      var eHeader = document.createElement("div");
      eHeader.classList.add("header");
      eCrash.appendChild(eHeader);
      elements.eHeader = eHeader;

      // Show signature and number of hits
      var eSignature = document.createElement("a");
      eSignature.classList.add("signature");
      eSignature.textContent = key;
      eSignature.name = key;
      eSignature.href = "#" + key;
      eHeader.appendChild(eSignature);
      elements.eSignature = eSignature;

      var eHits = document.createElement("span");
      eHits.classList.add("hits");
      eHeader.appendChild(eHits);
      elements.eHits = eHits;

      var eRefineDiv = document.createElement("div");
      eRefineDiv.textContent = "Refine data: ";
      eHeader.appendChild(eRefineDiv);

      var eRefineOnly = document.createElement("a");
      eRefineOnly.textContent = "only this signature";
      eRefineOnly.classList.add("resample");
      eRefineDiv.appendChild(eRefineOnly);
      elements.eRefineOnly = eRefineOnly;

      var urlOnly = new URL(window.location);
      key.split(" | ").forEach(sig => {
        urlOnly.searchParams.append("signature", "~" + sig);
      });
      eRefineOnly.href = urlOnly;

/*
      eRefineDiv.appendChild(document.createTextNode(" / "));

      var eRefineExclude = document.createElement("a");
      eRefineExclude.textContent = "exclude this signature";
      eRefineExclude.classList.add("resample");
      eRefineDiv.appendChild(eRefineExclude);
      elements.eRefineExclude = eRefineExclude;

      var urlExclude = new URL(window.location);
      key.split(" | ").forEach(sig => {
        urlExclude.searchParams.append("signature", "~!" + sig);
      });
      eRefineExclude.href = urlExclude;
*/
      // Show histograms
      var eStatisticsByDay = document.createElement("div");
      eStatisticsByDay.classList.add("statistics");
      elements.histogramsByDay = [];
      elements.contextByDay = View.prepareHistogram(eStatisticsByDay,
        elements.histogramsByDay, key);
      eCrash.appendChild(eStatisticsByDay);
      elements.eStatisticsByDay = eStatisticsByDay;

/*
      var eStatisticsByBuild = document.createElement("div");
      eStatisticsByBuild.classList.add("statistics");
      elements.histogramsByBuild = [];
      elements.contextByBuild = View.prepareHistogram(eStatisticsByBuild,
        elements.histogramsByBuild, key);
      eCrash.appendChild(eStatisticsByBuild);
      elements.eStatisticsByBuild = eStatisticsByBuild;
  */
      // Show links
      var eLinks = document.createElement("ul");
      eLinks.classList.add("links");
      eCrash.appendChild(eLinks);
      elements.eLinks = eLinks;

      // Show stacks
      var eStacks = document.createElement("div");
      eStacks.classList.add("stacks");
      eCrash.appendChild(eStacks);
      elements.eStacks = eStacks;

      // Show per build information
      var eBuildsParent = document.createElement("div");
      eCrash.appendChild(eBuildsParent);

      var eBuildsTitle = document.createElement("span");
      eBuildsTitle.textContent = "Spotted in builds";
      eBuildsTitle.classList.add("spotted_in_builds");
      eBuildsParent.appendChild(eBuildsTitle);

      var eBuilds = document.createElement("ul");
      eBuilds.classList.add("builds");
      eBuildsParent.appendChild(eBuilds);
      elements.eBuilds = eBuilds;

      this._elements.set(key, elements);
      return elements;
    },
  };

  var Data = {
    normalizeSample: function(sample) {
      var hits = sample.hits.map(hit => {
        var result = Util.strict({});
        for (var k of Object.keys(hit)) {
          result[k] = hit[k];
        }
        result.date = Date.parse(hit.date);
        try {
          result.annotation = Util.strict(JSON.parse(hit.async_shutdown_timeout));
        } catch (ex if ex instanceof SyntaxError) {
          ex.json = hit.async_shutdown_timeout;
          throw ex;
        }
        result.annotation.conditions.forEach((condition, i) => {
          if (typeof condition == "string") {
            // Deal with older format
            result.annotation.conditions[i] = { name: condition };
          }
        });
        result.hit = hit;
        delete result.async_shutdown_timeout;
        return result;
      });
      return hits.sort((h1, h2) => {
        if (h1.version == h2.version) {
          return h1.date >= h2.date;
        }
        return h1.version <= h2.version;
      });
    },

    getAllVersionsInvolved: function(normalized) {
      var byProduct = {};
      for (var hit of normalized) {
        if (!(hit.product in byProduct)) {
          byProduct[hit.product] = {};
        }
        byProduct[hit.product][hit.version] = true;
      }
      var list = [];
      for (var product of Object.keys(byProduct).sort()) {
        for (var version of Object.keys(byProduct[product])) {
          list.push({product: product, version: version});
        }
      }
      console.log("All versions involved", list);
      return list;
    },

    getAllSignaturesInvolved: function(normalized) {
      var signatures = {};
      for (var hit of normalized) {
        var names = [condition.name for (condition of
          hit.annotation.conditions)].sort();
        var key = names.join(" | ");
        if (!(key in signatures)) {
          signatures[key] = [];
        }
        signatures[key].push(hit);
      }
      return signatures;
    },

    // Group results by signature
    buildData: function(hits) {
      const now = Date.now();
      const MS_PER_DAY = 1000 * 3600 * 24;

      var map = new Map();

      // Group hits by signature/day/version
      for (var hit of hits) {
      
        // Determine signature
        var annotation = hit.annotation;
        var names = [condition.name for (condition of
                                       annotation.conditions)].sort();
        var key = names.join(" | ");
        if (names == "" || names == " | ") {
          console.log("Weird names", hit);
          throw new Error("Weird names");
        }

        // Group by signature
        var data = map.get(key);
        if (!data) {
          data = {
            all: [],
            byAge: []
          };
          map.set(key, data);
        }
        data.all.push(annotation);

        // Group by age
        var age = Math.floor((now - hit.date)/MS_PER_DAY);
        var thatDay = data.byAge[age];
        if (!thatDay) {
          data.byAge[age] = thatDay = { hits: 0, all: [], byVersion: {} };
        }
        thatDay.hits++;

        // Group by version
        var thatVersion = thatDay.byVersion.get(hit.version);
        if (!thatVersion) {
          thatVersion = [];
          thatDay.byVersion.set(hit.version, thatVersion);
        }
        thatDay.all.push(annotation);
        thatVersion.push(annotation);
      }

      console.log([...map]);
      return {
        /**
         * All the hits.
         */
        all: hits,

        /**
         * A map from key -> array indexed by age -> object indexed by version -> annotation
         */
        map: map,
      };
    },
  };

  // A few shortcuts
  var $ = id => document.getElementById(id);
  var status = View.status;


  // Fetch data piece-wise
  (function() {
    /**
     * Used only for documentation purposes.
     */
    function ServerSample() {
      /**
       * @type {Array<Report>}
       */
      this.hits = [];

      /**
       * Total number of crashes known to the server, before
       * capping. Always >= `this.hits.length`.
       */
      this.total = 0;
      this.facets = {};
    }

    /**
     * Used only for documentation purposes.
     */
    function NormalizedReport() {
      this.date = new Date();

      /**
       * AsyncShutdown annotation, as provided as part of key
       * async_shutdown_timeout.
       */
      this.annotation = {};

      // More fields, provided by the server.
    }

    function SignaturesByKey() {
      /**
       * @type {Array<NormalizedReport>}
       */
      this.all = [];
    }

    /**
     * Used only for documentation purposes.
     */
    function Signatures() {
      /**
       * @type {Array<[string, NormalizedReport]>}
       */
      this.sorted = [];

      /**
       * @type {Map<string, SignaturesByKey>} // FIXME: Changing
       */
      this.byKey = new Map();
    }

    /**
     * Used only for documentation purposes.
     */
    function NormalizedSample() {
      this.total = 0;

      /**
       * @type {Array<NormalizedReport>}
       */
      this.normalized = [];

      /**
       * Initialized by step "Extracting all versions involved".
       * @type {Array<{product: string, version: string}>
       */
      this.versions = null;

      /**
       * Initialized by step "Extracting all signatures".
       * @type {Signatures}
       */
      this.signatures = null;
    }

    var gDataByDay = [];

    /**
     * @type {Array<ServerSample>}
     */
    var gSampleByDay = [];
    var gArgs = new URL(window.location).searchParams;

    const DAYS_BACK = gArgs.has("days_back") ? Number.parseInt(gArgs.get("days_back")) : 7;
    const SAMPLE_SIZE = gArgs.has("sample_size") ? Number.parseInt(gArgs.get("sample_size")) : 200;

    var gRestrict = {
      versions: gArgs.getAll("version"),
      signatures: gArgs.getAll("signature"),
    };

    var schedule = function(status, code) {
      if (schedule.current == null) {
        schedule.current = Promise.resolve();
      }
      var copy = schedule.current;
      return schedule.current = Util.schedule(v => {
        View.status(status);
        return v;
      }, copy).then(v => Util.schedule(code, v)).then(
        result => {
          console.log("Done", status, result);
          return result;
        }
      );
    };

    var latestRun = 0;

    /**
     * Fetch data, run all analysis, display.
     *
     * If the data has already been fetched, use the in-memory cache.
     */
    var main = function(filters = undefined) {
      return Util.loop(0,
        age => age >= DAYS_BACK,
        age => age + 1)( age => {
          var thisRun = latestRun++;

          var next = function(...args) {
            if (thisRun != latestRun) {
              // Run has been cancelled
              return null;
            }
            return schedule(...args);
          };

          /**
           * @return {Promise<ServerSample>}
           */
          schedule("Getting sample for day " + age, () => {
            if (gSampleByDay[age]) {
              status("Getting sample from in-memory cache");
              return gSampleByDay[age];
            }
            return Server.getSampleForAge(age, gRestrict, SAMPLE_SIZE);
          });

          schedule("Storing sample",
            sample => {
              return gSampleByDay[age] = sample;
            });

          /**
           * @return {Promise<ServerSample>}
           */
          schedule("Applying filters",
            sample => {
              if (!filters) {
                status("No filters");
                return sample;
              }
              console.log("We need to filter out some stuff");
              var result = Util.strict({});
              for (var k of Object.keys(sample)) {
                result[k] = sample[k];
              }
              result.hits = result.hits.filter(hit => filters.get(hit.product, hit.version));
              console.log("Applying filters", result);
              return result;
          });

          /**
           * @return {Promise<NormalizedSample>}
           */
          schedule("Normalizing sample", sample => {
            var normalized = Data.normalizeSample(sample);
            console.log("Normalized data", normalized, sample.total);
            return gDataByDay[age] = Util.strict({
              total: sample.total,
              normalized: normalized,
            });
          });

          /**
           * @return {Promise<NormalizedSample>} with field `versions`
           */
          schedule("Extracting all versions involved", data => {
            var versions = Data.getAllVersionsInvolved(data.normalized);

            data.versions = versions; // List of {product, version}
            return data;
          });

          schedule("Setting up colors", data => {
            View.setupColors(data.versions, main);
            return data;
          });

          /**
           * @return {Promise<NormalizedSample>} with fields `versions`,
           * `signatures`.
           */
          schedule("Extracting all signatures", data => {
            status("Getting all signatures");
            var signatures = Data.getAllSignaturesInvolved(data.normalized);

            var list = [[k, signatures[k]] for (k of Object.keys(signatures))];
            list.sort((x, y) => x[1].length <= y[1].length);

            var byKey = new Map();
            for (var k of Object.keys(signatures)) {
              byKey.set(k, Util.strict({
                all: signatures[k],
              }));
            }

            data.signatures = Util.strict({
              byKey: byKey,
              sorted: list,
            });

            return data;
          });

          schedule("Showing signatures", data => {
            var estimates = {};
            var factor = data.total / data.normalized.length;
            var sampleSize = 0;
            var totalHits = 0;
            gDataByDay.forEach(oneDay => {
              oneDay.signatures.sorted.forEach(kv => {
                var [kind, signature] = kv;
                if (!(kind in estimates)) {
                  estimates[kind] = 0;
                }
                estimates[kind] += signature.length;
                sampleSize += signature.length;
              });
              totalHits += oneDay.total;
            });

            console.log("Total sample size", sampleSize);
            for (var [kind, signature] of data.signatures.sorted) {
              var display = View.prepareSignatureForDisplay(kind, DAYS_BACK);
              display.eHits.textContent = "Crashes: " + 
                Math.ceil((estimates[kind] * 100) / sampleSize) +
                "% of " + sampleSize + " samples (~" + Math.ceil(estimates[kind] * factor) + " total crashes over " + gDataByDay.length + " days)";
            };
            return data;
          });

          schedule("Updating histograms", data => {
            var factor = data.total / data.normalized.length;
            for (var [kind, signature] of data.signatures.sorted) {
/*
              // Classify per build
              var byBuild = Util.strict({
                all: new Map(),
                sorted: null,
              });
*/
              // Counting instances per version
              var byVersion = Util.strict({
                all: new Map(), // key => Array<hit>
                builds: new Map(), // key => {minBuild, maxBuild}
                sorted: null,
                total: 0,
              });

              for (var hit of signature) {
                // Classify by version
                var key = hit.product + " " + hit.version;
                if (!byVersion.all.has(key)) {
                  byVersion.all.set(key, []);
                  byVersion.builds.set(key, {minBuild: null, maxBuild:null});
                }
                byVersion.all.get(key).push(hit);
                byVersion.total++;

                var build = hit.build_id;
/*
                // Classify by build
                if (!byBuild.all.has(build)) {
                  byBuild.all.set(build, Util.strict({
                    byVersion: Util.strict({
                      all: new Map(),
                      sorted: null,
                      total: 0,
                    })
                  }));
                }
*/
                var builds = byVersion.builds.get(key);
                if (builds.minBuild == null || builds.minBuild > build) {
                  builds.minBuild = build;
                }
                if (builds.maxBuild == null || builds.maxBuild < build) {
                  builds.maxBuild = build;
                }
              }

              byVersion.sorted = [...byVersion.all].sort((x, y) => x[0] > y[0]);
//              byBuild.sorted = [...byBuild.all].sort((x, y) => x[0] > y[0]);
              data.signatures.byKey.get(kind).byVersion = byVersion;
//              data.signatures.byKey.get(kind).byBuild = byBuild;
//              console.log("Histogram by build", byBuild.sorted);
            }
            View.updateAllHistograms(gDataByDay, factor);
            View.updateAllBuildInformation(gDataByDay);
            return data;
          });

          schedule("Updating links", data => {
            View.updateAllLinks(gDataByDay, age);
            return data;
          });


          return schedule("Done for the day", () => {
            window.location.hash = window.location.hash;
            $("Results").classList.remove("loading");
            if (!filters) {
              return new Promise(resolve => window.setTimeout(resolve, 1000));
            } else {
              return undefined;
            }
          });

        }).then(() => {
          status("Done");
        });
    };
    main();

    return;
  })();

})();
