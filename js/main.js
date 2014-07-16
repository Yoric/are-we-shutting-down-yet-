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

    /**
     * Extract the "search" component of the URL of the page.
     *
     * @return {object} A key-value map.
     */
    getSearchArgs: function() {
      var search = window.location.search;
      if (!search || search[0] != "?") {
        return {};
      }
      var list = search.substring(1).split("&");
      var result = {};
      for (var item of list) {
        var [before, after] = item.split("=");
        if (!after) {
          after = true;
        }
        result[before] = after;
      }
      return result;
    },

    Filter: function() {
      /**
       * Map of product to set of version
       */
      this._byProduct = new Map();
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
    getSampleForAge: function(daysAgo, filter, sampleSize = 100) {
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

      if (filter) {
        for (var {version} of filter.getAccepts()) {
          options.push({version: version}); // Versions are OR-ed
        }
      }

      return Util.fetch(Server.BASE_URI, options, "", 1000, 5);
    },

    BASE_URI: "https://crash-stats.mozilla.com/api/SuperSearch/",

  };

  var View = {
    status: function(msg) {
      console.log("Status", msg);
      $("status").textContent = msg;
    },

    prepareHistogram: function(eStatistics, key) {
      var eCanvas = document.createElement("canvas");
      eStatistics.appendChild(eCanvas);
      var context = eCanvas.getContext("2d");

      const WIDTH = 300;
      const HEIGHT = 300;
      eCanvas.width = WIDTH;
      eCanvas.height = HEIGHT;
      eCanvas.style.width = WIDTH + "px";
      eCanvas.style.height = HEIGHT + "px";
      var rectangles = [];
      this._histogramRectangles.set(key, rectangles);

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

    _histogramRectangles: new Map(),
    updateHistogram: function(context, key, allDays, factor) {
      const WIDTH = 300;
      const HEIGHT = 300;
      const DAYS_BACK = allDays.length;
      context.fillStyle = "white";
      context.fillRect(0, 0, WIDTH, HEIGHT);

      var rectangles = this._histogramRectangles.get(key);
      rectangles.length = 0;

      // Determine max
      var max = 0;
      allDays.forEach((byDay, i) => {
        var byKey = byDay.signatures.byKey;
        if (!(key in byKey)) {
          // No such crash on that day
          return;
        }
        var byVersion = byKey[key].byVersion;
        if (byVersion.total > max) {
          max = byVersion.total;
        }
      });
      if (max == 0) {
        // Histogram is empty
        return;
      }

      // Display rectangles
      const H = HEIGHT/max;
      const W = WIDTH/DAYS_BACK;
      allDays.forEach((byDay, age) => {
        var x0 = WIDTH - W * (age + 1);
        var y0 = HEIGHT;
        var byKey = byDay.signatures.byKey;
        if (!(key in byKey)) {
          // No such crash on that day
          return;
        }
        var byVersion = byKey[key].byVersion;

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
        this.updateHistogram(v.context, k, allData, factor);
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
    _colors: new Map(),
    setupColors: function(versions, displayWithFilter) {
      var updateDisplayTimeout = null;

      var eVersions = $("Versions");
      eVersions.innerHTML = "";
      var eColors = document.createElement("ul");
      eVersions.appendChild(eColors);

      var boxToVersion = new Map();

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
        eCheckBox.checked = "checked";
        eSingleColor.appendChild(eCheckBox);
        boxToVersion.set(eCheckBox, v);

        eCheckBox.addEventListener("change", (v => event => {
          console.log("setupColors", "onchange", v);
          if (updateDisplayTimeout) {
            // Delay timeout by a few milliseconds
            window.clearTimeout(updateDisplayTimeout);
            updateDisplayTimeout = null;
          }
          updateDisplayTimeout = window.setTimeout(function() {
            schedule(() => {
              console.log("setupColors", "User requested a display update");
              updateDisplayTimeout = null;
              var filter = new Util.Filter();
              for (var [box, {product, version}] of boxToVersion) {
                console.log("setupColors", "adding to filter", product, version, box.checked);
                filter.set(product, version, box.checked);
              }
              console.log("setupColors", "has finished building the filter");
              schedule(displayWithFilter, filter);
            });
          }, 500);

        })(v));
      });
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

      // Show histogram
      var eStatistics = document.createElement("div");
      eStatistics.classList.add("statistics");
      elements.context = View.prepareHistogram(eStatistics, key);
      eCrash.appendChild(eStatistics);
      elements.eStatistics = eStatistics;
  
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

      this._elements.set(key, elements);
      return elements;
    },
  };

  var Data = {
    normalizeSample: function(sample) {
      var hits = sample.hits.map(hit => {
        var result = {};
        for (var k of Object.keys(hit)) {
          result[k] = hit[k];
        }
        result.date = Date.parse(hit.date);
        result.annotation = JSON.parse(hit.async_shutdown_timeout);
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
        var thatVersion = thatDay.byVersion[hit.version];
        if (!thatVersion) {
          thatDay.byVersion[hit.version] = thatVersion = [];
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
  var schedule = Util.schedule;
  var status = View.status;


  // Fetch data piece-wise
  (function() {
    var gDataByDay = [];
    var gSampleByDay = [];

    var args = Util.getSearchArgs();
    console.log("Arguments", args);
    const DAYS_BACK = args.days_back ? Number.parseInt(args.days_back) : 7;
    const SAMPLE_SIZE = args.sample_size ? Number.parseInt(args.sample_size) : 200;


    var schedule = function(status, code) {
      if (schedule.current == null) {
        schedule.current = Promise.resolve();
      }
      var copy = schedule.current;
      return schedule.current = Util.schedule(v => {
        View.status(status);
        return v;
      }, copy).then(v => Util.schedule(code, v));
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

          schedule("Getting sample for day " + age, () => {
            if (gSampleByDay[age]) {
              status("Getting sample from in-memory cache");
              return gSampleByDay[age];
            }
            return Server.getSampleForAge(age, filters, SAMPLE_SIZE);
          });

          schedule("Storing sample",
            sample => {
              return gSampleByDay[age] = sample;
            });

          schedule("Applying filters",
            sample => {
              if (!filters) {
                status("No filters");
                return sample;
              }
              console.log("We need to filter out some stuff");
              var result = {};
              for (var k of Object.keys(sample)) {
                result[k] = sample[k];
              }
              result.hits = result.hits.filter(hit => filters.get(hit.product, hit.version));
              return result;
          });

          schedule("Normalizing sample", sample => {
            var normalized = Data.normalizeSample(sample);;
            console.log("Normalied data", normalized);
            return gDataByDay[age] = {
              total: sample.total,
              normalized: normalized
            };
          });

          schedule("Extracting all versions involved", data => {
            var versions = Data.getAllVersionsInvolved(data.normalized);

            data.versions = versions; // List of {product, version}
            return data;
          });

          schedule("Setting up colors", data => {
            if (!filters) {
              View.setupColors(data.versions, filters => {
                console.log("Applying quick filters");
                var promise = main(filters);
                promise = promise.then(() => {
                  console.log("Now clearing cache and restarting with the full filters");
                  gDataByDay.length = 0;
                  gSampleByDay.length = 0;
                  return main(filters);
                });
              });
            }
            return data;
          });

          schedule("Extracting all signatures", data => {
            status("Getting all signatures");
            var signatures = Data.getAllSignaturesInvolved(data.normalized);

            var list = [[k, signatures[k]] for (k of Object.keys(signatures))];
            list.sort((x, y) => x[1].length <= y[1].length);

            var byKey = {};
            for (var k of Object.keys(signatures)) {
              byKey[k] = {all: signatures[k]};
            }

            data.signatures = {
              byKey: byKey,
              sorted: list
            };

            return data;
          });

          schedule("Showing signatures", data => {
            var estimates = {};
            var factor = data.total / data.normalized.length;
            gDataByDay.forEach(oneDay => {
              oneDay.signatures.sorted.forEach(kv => {
                var [kind, signature] = kv;
                if (!(kind in estimates)) {
                  estimates[kind] = 0;
                }
                estimates[kind] += signature.length;
              });
            });

            for (var [kind, signature] of data.signatures.sorted) {
              var display = View.prepareSignatureForDisplay(kind, DAYS_BACK);
              display.eHits.textContent = "Crashes: " + 
                Math.ceil((estimates[kind] * 100) / (SAMPLE_SIZE * gDataByDay.length)) +
                "% (~" + Math.ceil(estimates[kind] * factor) + " for " + gDataByDay.length + " days, estimated from a sample of " + SAMPLE_SIZE + " crashes per day)";
            };
            return data;
          });

          schedule("Updating histograms", data => {
            var factor = data.total / data.normalized.length;
            for (var [kind, signature] of data.signatures.sorted) {
              // Counting instances per version
              var byVersion = {};
              var total = 0;
              for (var hit of signature) {
                var key = hit.product + " " + hit.version;
                if (!(key in byVersion)) {
                byVersion[key] = [];
                }
                byVersion[key].push(hit);
                total++;
              }
              var sorted = [[k, byVersion[k]] for (k of Object.keys(byVersion))];
              sorted.sort((x, y) => x[0] > y[0]);

              data.signatures.byKey[kind].byVersion = {
                all: byVersion,
                sorted: sorted,
                total: total,
              };
            }
            View.updateAllHistograms(gDataByDay, factor);
            return data;
          });

          schedule("Updating links", data => {
            View.updateAllLinks(gDataByDay, age);
/*
            for (var [kind, signature] of data.signatures.sorted) {
              View.showLinks(kind, age, signature);
            }
*/
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
