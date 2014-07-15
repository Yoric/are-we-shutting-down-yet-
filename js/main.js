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

    fetch: function(uri, delay, attempts, message) {
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
            promise = promise.then(() => Util.fetch(uri, delay * 2, attempts
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
  };

  var Server = {
    getCount: function() {
      status("Fetching size of sample");
      var promise = Util.fetch(Server.BASE_URI + 1, 500, 10);
      return promise.then(data => data.total);
    },

    getAllMatching: function(suffix, description, chunkSize = 100) {
      var promise = Util.fetch(Server.BASE_URI + 1 + suffix, 100, 10);
      promise = promise.then(data => {
        var total = data.total;
        var buffer = [];
        return Util.loop(0,
                         x => x * chunkSize > total,
                         x => x + 1)(i => {
          status("Fetching items " + (i * chunkSize) + "-" +
                 ( (i + 1) * chunkSize ) + "/" +
                 total + " for " + description);
          var promise = Util.fetch(Server.BASE_URI + chunkSize +
                                   "&_results_offset=" + i *
                                   chunkSize,
                                   100, 10);
          promise = promise.then(batch => {
            status("Obtained items " + (i * chunkSize) + "-" +
                   ( (i + 1) * chunkSize ) + "/" +
                   total + " for " + description);
            buffer.push(batch);
            return buffer;
          });
          return promise;
        });
      });
      return promise;
    },

    /**
     * Get a sample of data for a given day
     *
     * @param {number} daysAgo A number (>=0)
     * @param {number} sampleSize
     *
     * @return {array} An array of payloads
     */
    getSampleForAge: function(daysAgo, sampleSize = 100) {
      var date = new Date();
      date.setDate(date.getDate() - daysAgo);
      var isoDay = date.toISOString().substring(0, 10);
      status("Fetching data for " + isoDay);
      date.setDate(date.getDate() + 1);      
      var isoNextDay = date.toISOString().substring(0, 10);

      return Util.fetch(Server.BASE_URI + sampleSize +
        "&date=>=" + isoDay +
        "&date=<=" + isoNextDay,
        100, 10);
    },

    getBatch: function(start, number) {
      var txtRange = "items " + start + " to " +
        (start + number);
      status("Fetching " + txtRange);
      var promise = Util.fetch(Server.BASE_URI + number + "&_results_offset=" +
                          start, start, 10, "(fetching " + txtRange + ")");
      return promise.then(data => {
        status("Received " + txtRange);
        return data;
      },
      () => {
        status("Failed to fetch " + txtRange + ",  giving up");
      });
    },

    BASE_URI: "https://crash-stats.mozilla.com/api/SuperSearch/?async_shutdown_timeout=!__null__&_results_number=",

  };

  var View = {
    status: function(msg) {
      console.log("Status", msg);
      $("status").textContent = msg;
    },



    prepareHistogram: function(eStatistics, daysBack) {
      var eCanvas = document.createElement("canvas");
      eStatistics.appendChild(eCanvas);
      var context = eCanvas.getContext("2d");

      const WIDTH = 300;
      const HEIGHT = 300;
      eCanvas.width = WIDTH;
      eCanvas.height = HEIGHT;
      eCanvas.style.width = WIDTH + "px";
      eCanvas.style.height = HEIGHT + "px";

      const W = WIDTH/daysBack;
      for (var age = 0; age < daysBack; ++age) {
        context.fillText("-" + age + "d", WIDTH - W * age, HEIGHT - 10);
      }
    },

    fooHistogram: function() {
      // Compute scale
      var maxHits = 0;
      for (var age = 0; age < 10; ++age) {
        var thatDay = crash.data.byAge[age];
        if (thatDay) {
          maxHits = Math.max(maxHits, thatDay.hits);
        }
      }

      const W = 30;
      const H = HEIGHT / maxHits;

      eCanvas.rectangles = [];

      // Now display actual histograms
      for (age = 0; age < 10; ++age) {
        thatDay = crash.data.byAge[age];
        var x0 = WIDTH - W * age;
        var y0 = HEIGHT;
        if (thatDay) {
          var width = W;
          for (var key of Object.keys(thatDay.byVersion).sort()) {
            console.log("Crash", crash.name, "age", age, "version", key, "color", View._colors.get(key));
            var hits = thatDay.byVersion[key].length;
            var product = thatDay.byVersion[key][0].hit.product;
            var height = hits * H;
            y0 = y0 - height;
            context.fillStyle = View._colors.get(key);
            context.fillRect(x0, y0, width, height);
            eCanvas.rectangles.push([x0, y0, width, height, key, product]);
          }
        }
        context.fillStyle = "black";
        context.fillText("-" + age + "d", x0, HEIGHT - 10);
        context.fillText(thatDay ? thatDay.hits : "0", x0, 10);
      }
      eCanvas.addEventListener("mousemove", function(event) {
        var canvas = event.target;
        if (canvas._delayedmousemove) {
          window.clearTimeout(canvas._delayedmousemove);
        }
        canvas._delayedmousemove = window.setTimeout(function() {
          canvas._delayedmousemove = null;
          var bounds = canvas.getBoundingClientRect();
          var x = event.clientX - bounds.left;
          var y = event.clientY - bounds.top;

          for (var [x0, y0, w, h, name, product] of canvas.rectangles) {
            if (x >= x0 && y >= y0 && x < x + w && y < y + h) {
              canvas.title = product + " " + name;
              return;
            }
          }
        });
        window.setTimeout(canvas._delayedmousemove, 1);
      });
    },

    showLinks: function(crash, eLinks) {
      status("Preparing links");
      const MAX_LINKS_PER_DAY = 20;
      for (var age = 0; age < crash.data.byAge.length; ++age) {
        var thatDay = crash.data.byAge[age];
        if (!thatDay) {
          continue;
        }

        var eSingleDay = document.createElement("li");
        eSingleDay.textContent = age + " days ago ";
        eLinks.appendChild(eSingleDay);

        var eDayLinks = document.createElement("ul");
        eSingleDay.appendChild(eDayLinks);

        var linksInDay = 0;
        for (var sample of thatDay.all) {
          var eSampleLi = document.createElement("li");
          eDayLinks.appendChild(eSampleLi);

          if (linksInDay++ >= MAX_LINKS_PER_DAY) {
            eSampleLi.textContent = "[...] (omitted " +
              (thatDay.all.length - MAX_LINKS_PER_DAY) + ")";
            break;
          }


          var eLink = document.createElement("a");
          eSampleLi.appendChild(eLink);
          eLink.href = "https://crash-stats.mozilla.com/report/index/" + sample.hit.uuid;
          eLink.textContent = sample.hit.uuid + " (" + sample.hit.version + ")";


          // Create a shallow copy of the sample without `hit` for serialiation purposes
          var noHit = {};
          for (var k of Object.keys(sample)) {
            noHit[k] = sample[k];
          }
          delete noHit.hit;
          eSampleLi.title = JSON.stringify(noHit, null, "\t");
        }
      }
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
    _versionsFilter: new Set(),

    setupColors: function(versions, displayWithFilter) {
      console.log("Initializing colors");

      var nextVersionsFilter = null;
      var updateDisplayTimeout = null;

      var eVersions = $("Versions");
      eVersions.innerHTML = "";
      var eColors = document.createElement("ul");
      eVersions.appendChild(eColors);

      versions.forEach((version, i) => {
        var color = "rgba(" + Math.floor(255 * ( 1 - i / versions.length ) ) + ", 100, 100, 1)";
        View._colors.set(version, color);

        var eSingleColor = document.createElement("li");
        eColors.appendChild(eSingleColor);
        eSingleColor.textContent = version;
        eSingleColor.style.color = color;

        var eCheckBox = document.createElement("input");
        eCheckBox.type = "checkbox";
        eCheckBox.checked = "checked";
        eSingleColor.appendChild(eCheckBox);

        eCheckBox.addEventListener("change", (version => event => {
          if (updateDisplayTimeout) {
            window.clearTimeout(updateDisplayTimeout);
          updateDisplayTimeout = null;
          }
          if (!nextVersionsFilter) {
            nextVersionsFilter = new Set();
            for (var k of View._versionsFilter.keys()) {
              nextVersionsFilter.add(k);
            }
          }
          if (event.target.checked) {
            nextVersionsFilter.add(version);
          } else {
            nextVersionsFilter.delete(version);
          }


          updateDisplayTimeout = window.setTimeout(function() {
            updateDisplayTimeout = null;
            var oldKeys = [...View._versionsFilter.keys()].sort();
            var newKeys = [...nextVersionsFilter.keys()].sort();
            console.log("Should we update display?", oldKeys, newKeys);

            if (oldKeys.join() != newKeys.join()) {
              console.log("Yes, we do");
              schedule(displayWithFilter, nextVersionsFilter);
            }
            View._versionsFilter = nextVersionsFilter;
            nextVersionsFilter = null;
          }, 500);

        })(versions[i]));
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
      View.prepareHistogram(eStatistics, daysBack);
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

    showEverything: function(sorted, eResults) {
      eResults.innerHTML = "";
      for (var crash of sorted) {
        console.log("Crash", crash);
        var eCrash = document.createElement("div");
        eCrash.classList.add("crash");
        eResults.appendChild(eCrash);

        var eHeader = document.createElement("div");
        eHeader.classList.add("header");
        eCrash.appendChild(eHeader);

        // Show signature and number of hits
        var eSignature = document.createElement("a");
        eSignature.classList.add("signature");
        eSignature.textContent = crash.name;
        eSignature.name = crash.name;
        eSignature.href = "#" + crash.name;
        eHeader.appendChild(eSignature);

        var eHits = document.createElement("span");
        eHits.classList.add("hits");
        eHits.textContent = crash.hits + " crashes";
        eHeader.appendChild(eHits);

        // Show histogram
        var eStatistics = document.createElement("div");
        eStatistics.classList.add("statistics");
        eCrash.appendChild(eStatistics);
        schedule(View.showHistogram, crash, eStatistics);


        // Show links
        var eLinks = document.createElement("ul");
        eLinks.classList.add("links");
        eCrash.appendChild(eLinks);
        schedule(View.showLinks, crash, eLinks);

        // Show stacks
        var eStacks = document.createElement("div");
        eStacks.classList.add("stacks");
        eCrash.appendChild(eStacks);
        schedule(View.showStacks, crash, eStacks);
      }
      eResults.classList.remove("loading");
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
      var versions = {};
      for (var hit of normalized) {
        versions[hit.product + " " + hit.version] = true;
      }
      return Object.keys(versions).sort();
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
      console.log("Grouping hits");

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

      console.log("Map contains", map.size, "signatures");
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

    // Sort by number of hits
    sortHits: function(data, filter) {
      var list = [];
      for (var [k, {all, byAge}] of data.map) {
        var all2 = [];
        var byAge2 = [];
        var hits2 = 0;
        byAge.forEach((thatDay, i) => {
          console.log("byAge", thatDay, i);
          if (!thatDay) {
            return;
          }
          var thatDay2 = { hits: 0, all: [], byVersion: {} };
          for (var version of Object.keys(thatDay.byVersion)) {
            if (filter.has(version)) {
              var thatVersion = thatDay.byVersion[version];
              thatDay2.byVersion[version] = thatVersion;
              thatDay2.hits += thatVersion.length;
              thatDay2.all.push(...thatVersion);
              all2.push(...thatVersion);
            }
          }
          if (thatDay2.hits) {
            hits2 += thatDay2.hits;
            byAge2[i] = thatDay2;
          }
        });
        list.push({name: k, data: {all: all2, byAge: byAge2}, hits: hits2});
      }
      return list.sort((a, b) => a.hits <= b.hits);
    },
  };

  // A few shortcuts
  var $ = id => document.getElementById(id);
  var schedule = Util.schedule;
  var status = View.status;



  // Fetch data piece-wise
  (function() {
    const DAYS_BACK = 7;

    var gCurrentAge = 0;

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


    schedule("Getting sample for day " + gCurrentAge,
      () => Server.getSampleForAge(gCurrentAge, 200));

    schedule("Normalizing sample", sample => {
      var age = 0;
      console.log("Received a sample for the day", age, sample);
      var normalized = Data.normalizeSample(sample);;
      console.log("After rewriting", normalized);

      return {
        total: sample.total,
        normalized: normalized
      };
    });

    schedule("Extracting all versions involved", data => {
      var versions = Data.getAllVersionsInvolved(data.normalized);
      console.log("Versions involved", versions);

      data.versions = versions;
      return data;
    });

    schedule("Setting up colors", data => {
      View.setupColors(data.versions);
      return data;
    });

    schedule("Extracting all signatures", data => {
      status("Getting all signatures");
      var signatures = Data.getAllSignaturesInvolved(data.normalized);
      console.log("Signatures involved", signatures);

      data.signatures = signatures;
      return data;
    });

    schedule("Showing signatures", data => {
      console.log("Total", data.total);
      console.log("Normalized", data.normalized.length);
      var factor = data.total / data.normalized.length;
      console.log("Factor", factor);

      var list = [[k, data.signatures[k]] for (k of Object.keys(data.signatures))];
      list.sort((x, y) => x[1].length <= y[1].length);

      for (var [kind, signature] of list) {
        console.log("Displaying signature", kind);
        var estimate =  Math.ceil(signature.length * factor); // FIXME: This should actually be summed for all days
        console.log("Estimate", estimate);
        var display = View.prepareSignatureForDisplay(kind, DAYS_BACK);
        console.log("Display");
        display.eHits.textContent = "Crashes: " + estimate + " (est)";
      };
      return data;
    });

    schedule("Updating histogram for day " + gCurrentAge, data => {
    });

    schedule("Done", () => {});

    // FIXME: Display/update all versions involved
    // FIXME: Show list of signatures
    // FIXME: Show histogram
    // FIXME: Show links


    return;
/*
      var data = [];
      return Util.loop(0,
                       i => i < buffer.length,
                       i => i + 1)(i => {
        console.log("Rewriting chunk", i, "with size",
          buffer[i].hits.length);
        buffer[i].hits.forEach(hit => {
          var item = {
            date: Date.parse(hit.date),
            annotation: JSON.parse(hit.async_shutdown_timeout),
            hit: hit
          };
          item.annotation.conditions.forEach((condition, i) => {
            if (typeof condition == "string") {
              // Deal with older format
              item.annotation.conditions[i] = { name: condition };
            }
          });
          data.push(item);
        });
        return Util.wait(10).then(() => data);
      });
    });
    return;
*/
    var gHits = [];
    var promise = Server.getCount();

    promise = promise.then(count =>
      loop(0, count / 100, 1, i => {
        var promise = Util.wait(i * 200);
        promise = promise.then(() => Server.getBatch(i * 100, 100));
        promise = promise.then(batch => Data.addBatch(batch, gHits));
        promise = promise.then(() => schedule(Data.buildData, gHits));
        var data;
        promise = promise.then(_data => data = _data);
        promise = promise.then(() => schedule(View.setupColors, data));
        promise = promise.then(() => schedule(Data.sortHits, data, View._versionsFilter));
        var sorted;
        promise = promise.then(_sorted => sorted = _sorted);
        promise = promise.then(() => {
          console.log("A");
          schedule(View.showEverything, sorted, $("Results"));
          console.log("B");
        });
        promise = promise.then(() => {
          status("Display of batch " + i + " complete");
          window.location.hash = window.location.hash;
        });
        return promise;
      })
    );

    promise = promise.then(() =>
      status("Done")
    );
  })();

})();
