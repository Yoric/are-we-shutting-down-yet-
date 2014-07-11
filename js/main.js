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
      return new Promise((resolve, reject) => {
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
      });
    },

    fetch: function(uri, delay, attempts, message) {
      if (!attempts) {
        return new Promise(resolve => "Too many attempts");
      }

      var xhr = new XMLHttpRequest();
      var result = new Promise((resolve, reject) =>
        xhr.addEventListener("load", function(event) {
          console.log("Load complete", xhr.status);
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

  };

  var Server = {
    getCount: function() {
      status("Fetching size of sample");
      var promise = Util.fetch(Server.BASE_URI + 1, 500, 10);
      return promise.then(data => data.total);
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

    showHistogram: function(crash, eStatistics) {
      status("Preparing histogram");

      var eCanvas = document.createElement("canvas");
      eStatistics.appendChild(eCanvas);
      var context = eCanvas.getContext("2d");

      const WIDTH = 300;
      const HEIGHT = 300;
      eCanvas.width = WIDTH;
      eCanvas.height = HEIGHT;
      eCanvas.style.width = WIDTH + "px";
      eCanvas.style.height = HEIGHT + "px";

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

    setupColors: function(data) {
      console.log("Initializing colors");

      var nextVersionsFilter = null;
      var updateDisplayTimeout = null;

      var versions = new Map();
      for (var hit of data.all) {
        versions.set(hit.version, hit.product);
        View._versionsFilter.add(hit.version);
      }

      var sorted = [...versions.keys()].sort();

      var eVersions = $("Versions");
      eVersions.innerHTML = "";
      var eColors = document.createElement("ul");
      eVersions.appendChild(eColors);

      for (var i = 0; i < sorted.length; ++i) {
        var color = "rgba(" + Math.floor(255 * ( 1 - i / sorted.length ) ) + ", 100, 100, 1)";
        View._colors.set(sorted[i], color);

        var eSingleColor = document.createElement("li");
        eColors.appendChild(eSingleColor);
        eSingleColor.textContent = versions.get(sorted[i]) + " " + sorted[i];
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
              var promise = schedule(Data.sortHits, data, View._versionsFilter);
              promise.then((sorted) =>
                schedule(View.showEverything, sorted, $("Results"))
              );
            }
            View._versionsFilter = nextVersionsFilter;
            nextVersionsFilter = null;
          }, 500);

        })(sorted[i]));
      }

      return data;
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
    addBatch: function(batch, destination) {
      console.log("Rewriting batch", "adding", batch.hits.length, "to", destination.length);
      batch.hits.forEach(hit => {
        hit.date = Date.parse(hit.date);
        hit.annotation = JSON.parse(hit.async_shutdown_timeout);
        hit.annotation.hit = hit;
        hit.annotation.conditions.forEach((condition, i) => {
          if (typeof condition == "string") {
            // Deal with older format
            hit.annotation.conditions[i] = { name: condition };
          }
        });
      });
      destination.push(...batch.hits);

      // Re-sort everything. Sadly, I don't think we can do better.
      return destination.sort((h1, h2) => {
        if (h1.version == h2.version) {
          return h1.date >= h2.date;
        }
        return h1.version <= h2.version;
      });
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
    var gHits = [];
    var promise = Server.getCount();

    var loop = function(start, stop, increment, cb) {
      return new Promise((resolve, reject) => {
        if (start > stop) {
          resolve();
          return;
        }
        var promise = cb(start);
        promise = promise.then(() => loop(start + increment, stop,
        increment, cb));
        promise.then(resolve, reject);
      });
    };

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
