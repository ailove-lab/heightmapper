(function(){function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s}return e})()({1:[function(require,module,exports){
(function (global){
/*
 * leaflet-geocoder-mapzen
 * Leaflet plugin to search (geocode) using Mapzen Search or your
 * own hosted version of the Pelias Geocoder API.
 *
 * License: MIT
 * (c) Mapzen
 */
;(function (factory) { // eslint-disable-line no-extra-semi
  var L;
  if (typeof define === 'function' && define.amd) {
    // AMD
    define(['leaflet'], factory);
  } else if (typeof module !== 'undefined') {
    // Node/CommonJS
    L = (typeof window !== "undefined" ? window['L'] : typeof global !== "undefined" ? global['L'] : null);
    module.exports = factory(L);
  } else {
    // Browser globals
    if (typeof window.L === 'undefined') {
      throw new Error('Leaflet must be loaded first');
    }
    factory(window.L);
  }
}(function (L) {
  'use strict';

  var MINIMUM_INPUT_LENGTH_FOR_AUTOCOMPLETE = 1;
  var FULL_WIDTH_MARGIN = 20; // in pixels
  var FULL_WIDTH_TOUCH_ADJUSTED_MARGIN = 4; // in pixels
  var RESULTS_HEIGHT_MARGIN = 20; // in pixels
  var API_RATE_LIMIT = 250; // in ms, throttled time between subsequent requests to API

  L.Control.Geocoder = L.Control.extend({

    version: '1.7.1',

    includes: L.Mixin.Events,

    options: {
      position: 'topleft',
      attribution: 'Geocoding by <a href="https://mapzen.com/projects/search/">Mapzen</a>',
      url: 'https://search.mapzen.com/v1',
      placeholder: 'Search',
      title: 'Search',
      bounds: false,
      focus: true,
      layers: null,
      panToPoint: true,
      pointIcon: true, // 'images/point_icon.png',
      polygonIcon: true, // 'images/polygon_icon.png',
      fullWidth: 650,
      markers: true,
      expanded: false,
      autocomplete: true,
      place: false
    },

    initialize: function (apiKey, options) {
      // For IE8 compatibility (if XDomainRequest is present),
      // we set the default value of options.url to the protocol-relative
      // version, because XDomainRequest does not allow http-to-https requests
      // This is set first so it can always be overridden by the user
      if (window.XDomainRequest) {
        this.options.url = '//search.mapzen.com/v1';
      }

      // If the apiKey is omitted entirely and the
      // first parameter is actually the options
      if (typeof apiKey === 'object' && !!apiKey) {
        options = apiKey;
      } else {
        this.apiKey = apiKey;
      }

      // Deprecation warnings
      // If options.latlng is defined, warn. (Do not check for falsy values, because it can be set to false.)
      if (options && typeof options.latlng !== 'undefined') {
        // Set user-specified latlng to focus option, but don't overwrite if it's already there
        if (typeof options.focus === 'undefined') {
          options.focus = options.latlng;
        }
        console.log('[leaflet-geocoder-mapzen] DEPRECATION WARNING:',
          'As of v1.6.0, the `latlng` option is deprecated. It has been renamed to `focus`. `latlng` will be removed in a future version.');
      }

      // Now merge user-specified options
      L.Util.setOptions(this, options);
      this.markers = [];
    },

    /**
     * Resets the geocoder control to an empty state.
     *
     * @public
     */
    reset: function () {
      this._input.value = '';
      L.DomUtil.addClass(this._reset, 'leaflet-pelias-hidden');
      this.removeMarkers();
      this.clearResults();
      this.fire('reset');
    },

    getLayers: function (params) {
      var layers = this.options.layers;

      if (!layers) {
        return params;
      }

      params.layers = layers;
      return params;
    },

    getBoundingBoxParam: function (params) {
      /*
       * this.options.bounds can be one of the following
       * true //Boolean - take the map bounds
       * false //Boolean - no bounds
       * L.latLngBounds(...) //Object
       * [[10, 10], [40, 60]] //Array
      */
      var bounds = this.options.bounds;

      // If falsy, bail
      if (!bounds) {
        return params;
      }

      // If set to true, use map bounds
      // If it is a valid L.LatLngBounds object, get its values
      // If it is an array, try running it through L.LatLngBounds
      if (bounds === true) {
        bounds = this._map.getBounds();
        params = makeParamsFromLeaflet(params, bounds);
      } else if (typeof bounds === 'object' && bounds.isValid && bounds.isValid()) {
        params = makeParamsFromLeaflet(params, bounds);
      } else if (L.Util.isArray(bounds)) {
        var latLngBounds = L.latLngBounds(bounds);
        if (latLngBounds.isValid && latLngBounds.isValid()) {
          params = makeParamsFromLeaflet(params, latLngBounds);
        }
      }

      function makeParamsFromLeaflet (params, latLngBounds) {
        params['boundary.rect.min_lon'] = latLngBounds.getWest();
        params['boundary.rect.min_lat'] = latLngBounds.getSouth();
        params['boundary.rect.max_lon'] = latLngBounds.getEast();
        params['boundary.rect.max_lat'] = latLngBounds.getNorth();
        return params;
      }

      return params;
    },

    getFocusParam: function (params) {
      /**
       * this.options.focus can be one of the following
       * [50, 30]           // Array
       * {lon: 30, lat: 50} // Object
       * {lat: 50, lng: 30} // Object
       * L.latLng(50, 30)   // Object
       * true               // Boolean - take the map center
       * false              // Boolean - No latlng to be considered
       */
      var focus = this.options.focus;

      if (!focus) {
        return params;
      }

      if (focus === true) {
        // If focus option is Boolean true, use current map center
        var mapCenter = this._map.getCenter();
        params['focus.point.lat'] = mapCenter.lat;
        params['focus.point.lon'] = mapCenter.lng;
      } else if (typeof focus === 'object') {
        // Accepts array, object and L.latLng form
        // Constructs the latlng object using Leaflet's L.latLng()
        // [50, 30]
        // {lon: 30, lat: 50}
        // {lat: 50, lng: 30}
        // L.latLng(50, 30)
        var latlng = L.latLng(focus);
        params['focus.point.lat'] = latlng.lat;
        params['focus.point.lon'] = latlng.lng;
      }

      return params;
    },

    // @method getParams(params: Object)
    // Collects all the parameters in a single object from various options,
    // including options.bounds, options.focus, options.layers, the api key,
    // and any params that are provided as a argument to this function.
    // Note that options.params will overwrite any of these
    getParams: function (params) {
      params = params || {};
      params = this.getBoundingBoxParam(params);
      params = this.getFocusParam(params);
      params = this.getLayers(params);

      // Search API key
      if (this.apiKey) {
        params.api_key = this.apiKey;
      }

      var newParams = this.options.params;

      if (!newParams) {
        return params;
      }

      if (typeof newParams === 'object') {
        for (var prop in newParams) {
          params[prop] = newParams[prop];
        }
      }

      return params;
    },

    search: function (input) {
      // Prevent lack of input from sending a malformed query to Pelias
      if (!input) return;

      var url = this.options.url + '/search';
      var params = {
        text: input
      };

      this.callPelias(url, params, 'search');
    },

    autocomplete: throttle(function (input) {
      // Prevent lack of input from sending a malformed query to Pelias
      if (!input) return;

      var url = this.options.url + '/autocomplete';
      var params = {
        text: input
      };

      this.callPelias(url, params, 'autocomplete');
    }, API_RATE_LIMIT),

    place: function (id) {
      // Prevent lack of input from sending a malformed query to Pelias
      if (!id) return;

      var url = this.options.url + '/place';
      var params = {
        ids: id
      };

      this.callPelias(url, params, 'place');
    },

    handlePlaceResponse: function (response) {
      // Placeholder for handling place response
    },

    // Timestamp of the last response which was successfully rendered to the UI.
    // The time represents when the request was *sent*, not when it was recieved.
    maxReqTimestampRendered: new Date().getTime(),

    callPelias: function (endpoint, params, type) {
      params = this.getParams(params);

      L.DomUtil.addClass(this._search, 'leaflet-pelias-loading');

      // Track when the request began
      var reqStartedAt = new Date().getTime();

      AJAX.request(endpoint, params, function (err, results) {
        L.DomUtil.removeClass(this._search, 'leaflet-pelias-loading');

        if (err) {
          var errorMessage;
          switch (err.code) {
            // Error codes.
            // https://mapzen.com/documentation/search/http-status-codes/
            case 403:
              errorMessage = 'A valid API key is needed for this search feature.';
              break;
            case 404:
              errorMessage = 'The search service cannot be found. :-(';
              break;
            case 408:
              errorMessage = 'The search service took too long to respond. Try again in a second.';
              break;
            case 429:
              errorMessage = 'There were too many requests. Try again in a second.';
              break;
            case 500:
              errorMessage = 'The search service is not working right now. Please try again later.';
              break;
            case 502:
              errorMessage = 'Connection lost. Please try again later.';
              break;
            // Note the status code is 0 if CORS is not enabled on the error response
            default:
              errorMessage = 'The search service is having problems :-(';
              break;
          }
          this.showMessage(errorMessage);
          this.fire('error', {
            results: results,
            endpoint: endpoint,
            requestType: type,
            params: params,
            errorCode: err.code,
            errorMessage: errorMessage
          });
        }

        // There might be an error message from the geocoding service itself
        if (results && results.geocoding && results.geocoding.errors) {
          errorMessage = results.geocoding.errors[0];
          this.showMessage(errorMessage);
          this.fire('error', {
            results: results,
            endpoint: endpoint,
            requestType: type,
            params: params,
            errorCode: err.code,
            errorMessage: errorMessage
          });
          return;
        }

        // Autocomplete and search responses
        if (results && results.features) {
          // Check if request is stale:
          // Only for autocomplete or search endpoints
          // Ignore requests if input is currently blank
          // Ignore requests that started before a request which has already
          // been successfully rendered on to the UI.
          if (type === 'autocomplete' || type === 'search') {
            if (this._input.value === '' || this.maxReqTimestampRendered >= reqStartedAt) {
              return;
            } else {
              // Record the timestamp of the request.
              this.maxReqTimestampRendered = reqStartedAt;
            }
          }

          // Placeholder: handle place response
          if (type === 'place') {
            this.handlePlaceResponse(results);
          }

          // Show results
          if (type === 'autocomplete' || type === 'search') {
            this.showResults(results.features, params.text);
          }

          // Fire event
          this.fire('results', {
            results: results,
            endpoint: endpoint,
            requestType: type,
            params: params
          });
        }
      }, this);
    },

    highlight: function (text, focus) {
      var r = RegExp('(' + escapeRegExp(focus) + ')', 'gi');
      return text.replace(r, '<strong>$1</strong>');
    },

    getIconType: function (layer) {
      var pointIcon = this.options.pointIcon;
      var polygonIcon = this.options.polygonIcon;
      var classPrefix = 'leaflet-pelias-layer-icon-';

      if (layer.match('venue') || layer.match('address')) {
        if (pointIcon === true) {
          return {
            type: 'class',
            value: classPrefix + 'point'
          };
        } else if (pointIcon === false) {
          return false;
        } else {
          return {
            type: 'image',
            value: pointIcon
          };
        }
      } else {
        if (polygonIcon === true) {
          return {
            type: 'class',
            value: classPrefix + 'polygon'
          };
        } else if (polygonIcon === false) {
          return false;
        } else {
          return {
            type: 'image',
            value: polygonIcon
          };
        }
      }
    },

    showResults: function (features, input) {
      // Exit function if there are no features
      if (features.length === 0) {
        this.showMessage('No results were found.');
        return;
      }

      var resultsContainer = this._results;

      // Reset and display results container
      resultsContainer.innerHTML = '';
      resultsContainer.style.display = 'block';
      // manage result box height
      resultsContainer.style.maxHeight = (this._map.getSize().y - resultsContainer.offsetTop - this._container.offsetTop - RESULTS_HEIGHT_MARGIN) + 'px';

      var list = L.DomUtil.create('ul', 'leaflet-pelias-list', resultsContainer);

      for (var i = 0, j = features.length; i < j; i++) {
        var feature = features[i];
        var resultItem = L.DomUtil.create('li', 'leaflet-pelias-result', list);

        resultItem.feature = feature;
        resultItem.layer = feature.properties.layer;

        // Deprecated
        // Use L.GeoJSON.coordsToLatLng(resultItem.feature.geometry.coordinates) instead
        // This returns a L.LatLng object that can be used throughout Leaflet
        resultItem.coords = feature.geometry.coordinates;

        var icon = this.getIconType(feature.properties.layer);
        if (icon) {
          // Point or polygon icon
          // May be a class or an image path
          var layerIconContainer = L.DomUtil.create('span', 'leaflet-pelias-layer-icon-container', resultItem);
          var layerIcon;

          if (icon.type === 'class') {
            layerIcon = L.DomUtil.create('div', 'leaflet-pelias-layer-icon ' + icon.value, layerIconContainer);
          } else {
            layerIcon = L.DomUtil.create('img', 'leaflet-pelias-layer-icon', layerIconContainer);
            layerIcon.src = icon.value;
          }

          layerIcon.title = 'layer: ' + feature.properties.layer;
        }

        resultItem.innerHTML += this.highlight(feature.properties.label, input);
      }
    },

    showMessage: function (text) {
      var resultsContainer = this._results;

      // Reset and display results container
      resultsContainer.innerHTML = '';
      resultsContainer.style.display = 'block';

      var messageEl = L.DomUtil.create('div', 'leaflet-pelias-message', resultsContainer);

      // Set text. This is the most cross-browser compatible method
      // and avoids the issues we have detecting either innerText vs textContent
      // (e.g. Firefox cannot detect textContent property on elements, but it's there)
      messageEl.appendChild(document.createTextNode(text));
    },

    removeMarkers: function () {
      if (this.options.markers) {
        for (var i = 0; i < this.markers.length; i++) {
          this._map.removeLayer(this.markers[i]);
        }
        this.markers = [];
      }
    },

    showMarker: function (text, latlng) {
      this._map.setView(latlng, this._map.getZoom() || 8);

      var markerOptions = (typeof this.options.markers === 'object') ? this.options.markers : {};

      if (this.options.markers) {
        var marker = new L.marker(latlng, markerOptions).bindPopup(text); // eslint-disable-line new-cap
        this._map.addLayer(marker);
        this.markers.push(marker);
        marker.openPopup();
      }
    },

    /**
     * Fits the map view to a given bounding box.
     * Mapzen Search / Pelias returns the 'bbox' property on 'feature'. It is
     * as an array of four numbers:
     *   [
     *     0: southwest longitude,
     *     1: southwest latitude,
     *     2: northeast longitude,
     *     3: northeast latitude
     *   ]
     * This method expects the array to be passed directly and it will be converted
     * to a boundary parameter for Leaflet's fitBounds().
     */
    fitBoundingBox: function (bbox) {
      this._map.fitBounds([
        [ bbox[1], bbox[0] ],
        [ bbox[3], bbox[2] ]
      ], {
        animate: true,
        maxZoom: 16
      });
    },

    setSelectedResult: function (selected, originalEvent) {
      var latlng = L.GeoJSON.coordsToLatLng(selected.feature.geometry.coordinates);
      this._input.value = selected.innerText || selected.textContent;
      if (selected.feature.bbox) {
        this.removeMarkers();
        this.fitBoundingBox(selected.feature.bbox);
      } else {
        this.removeMarkers();
        this.showMarker(selected.innerHTML, latlng);
      }
      this.fire('select', {
        originalEvent: originalEvent,
        latlng: latlng,
        feature: selected.feature
      });
      this.blur();

      if (this.options.place) {
        this.place(selected.feature.properties.gid);
      }
    },

    /**
     * Convenience function for focusing on the input
     * A `focus` event is fired, but it is not fired here. An event listener
     * was added to the _input element to forward the native `focus` event.
     *
     * @public
     */
    focus: function () {
      // If not expanded, expand this first
      if (!L.DomUtil.hasClass(this._container, 'leaflet-pelias-expanded')) {
        this.expand();
      }
      this._input.focus();
    },

    /**
     * Removes focus from geocoder control
     * A `blur` event is fired, but it is not fired here. An event listener
     * was added on the _input element to forward the native `blur` event.
     *
     * @public
     */
    blur: function () {
      this._input.blur();
      this.clearResults();
      if (this._input.value === '' && this._results.style.display !== 'none') {
        L.DomUtil.addClass(this._reset, 'leaflet-pelias-hidden');
        if (!this.options.expanded) {
          this.collapse();
        }
      }
    },

    clearResults: function (force) {
      // Hide results from view
      this._results.style.display = 'none';

      // Destroy contents if input has also cleared
      // OR if force is true
      if (this._input.value === '' || force === true) {
        this._results.innerHTML = '';
      }
    },

    expand: function () {
      L.DomUtil.addClass(this._container, 'leaflet-pelias-expanded');
      this.setFullWidth();
      this.fire('expand');
    },

    collapse: function () {
      // 'expanded' options check happens outside of this function now
      // So it's now possible for a script to force-collapse a geocoder
      // that otherwise defaults to the always-expanded state
      L.DomUtil.removeClass(this._container, 'leaflet-pelias-expanded');
      this._input.blur();
      this.clearFullWidth();
      this.clearResults();
      this.fire('collapse');
    },

    // Set full width of expanded input, if enabled
    setFullWidth: function () {
      if (this.options.fullWidth) {
        // If fullWidth setting is a number, only expand if map container
        // is smaller than that breakpoint. Otherwise, clear width
        // Always ask map to invalidate and recalculate size first
        this._map.invalidateSize();
        var mapWidth = this._map.getSize().x;
        var touchAdjustment = L.Browser.touch ? FULL_WIDTH_TOUCH_ADJUSTED_MARGIN : 0;
        var width = mapWidth - FULL_WIDTH_MARGIN - touchAdjustment;
        if (typeof this.options.fullWidth === 'number' && mapWidth >= window.parseInt(this.options.fullWidth, 10)) {
          this.clearFullWidth();
          return;
        }
        this._container.style.width = width.toString() + 'px';
      }
    },

    clearFullWidth: function () {
      // Clear set width, if any
      if (this.options.fullWidth) {
        this._container.style.width = '';
      }
    },

    onAdd: function (map) {
      var container = L.DomUtil.create('div',
          'leaflet-pelias-control leaflet-bar leaflet-control');

      this._body = document.body || document.getElementsByTagName('body')[0];
      this._container = container;
      this._input = L.DomUtil.create('input', 'leaflet-pelias-input', this._container);
      this._input.spellcheck = false;

      // Forwards focus and blur events from input to geocoder
      L.DomEvent.addListener(this._input, 'focus', function (e) {
        this.fire('focus', { originalEvent: e });
      }, this);

      L.DomEvent.addListener(this._input, 'blur', function (e) {
        this.fire('blur', { originalEvent: e });
      }, this);

      // Only set if title option is not null or falsy
      if (this.options.title) {
        this._input.title = this.options.title;
      }

      // Only set if placeholder option is not null or falsy
      if (this.options.placeholder) {
        this._input.placeholder = this.options.placeholder;
      }

      this._search = L.DomUtil.create('a', 'leaflet-pelias-search-icon', this._container);
      this._reset = L.DomUtil.create('div', 'leaflet-pelias-close leaflet-pelias-hidden', this._container);
      this._reset.innerHTML = '×';
      this._reset.title = 'Reset';

      this._results = L.DomUtil.create('div', 'leaflet-pelias-results leaflet-bar', this._container);

      if (this.options.expanded) {
        this.expand();
      }

      L.DomEvent
        .on(this._container, 'click', function (e) {
          // Child elements with 'click' listeners should call
          // stopPropagation() to prevent that event from bubbling to
          // the container & causing it to fire too greedily
          this._input.focus();
        }, this)
        .on(this._input, 'focus', function (e) {
          if (this._input.value && this._results.children.length) {
            this._results.style.display = 'block';
          }
        }, this)
        .on(this._map, 'click', function (e) {
          // Does what you might expect a _input.blur() listener might do,
          // but since that would fire for any reason (e.g. clicking a result)
          // what you really want is to blur from the control by listening to clicks on the map
          this.blur();
        }, this)
        .on(this._search, 'click', function (e) {
          L.DomEvent.stopPropagation(e);

          // Toggles expanded state of container on click of search icon
          if (L.DomUtil.hasClass(this._container, 'leaflet-pelias-expanded')) {
            // If expanded option is true, just focus the input
            if (this.options.expanded === true) {
              this._input.focus();
              return;
            } else {
              // Otherwise, toggle to hidden state
              L.DomUtil.addClass(this._reset, 'leaflet-pelias-hidden');
              this.collapse();
            }
          } else {
            // If not currently expanded, clicking here always expands it
            if (this._input.value.length > 0) {
              L.DomUtil.removeClass(this._reset, 'leaflet-pelias-hidden');
            }
            this.expand();
            this._input.focus();
          }
        }, this)
        .on(this._reset, 'click', function (e) {
          this.reset();
          this._input.focus();
          L.DomEvent.stopPropagation(e);
        }, this)
        .on(this._input, 'keydown', function (e) {
          var list = this._results.querySelectorAll('.leaflet-pelias-result');
          var selected = this._results.querySelectorAll('.leaflet-pelias-selected')[0];
          var selectedPosition;
          var self = this;
          var panToPoint = function (shouldPan) {
            var _selected = self._results.querySelectorAll('.leaflet-pelias-selected')[0];
            if (_selected && shouldPan) {
              if (_selected.feature.bbox) {
                self.removeMarkers();
                self.fitBoundingBox(_selected.feature.bbox);
              } else {
                self.removeMarkers();
                self.showMarker(_selected.innerHTML, L.GeoJSON.coordsToLatLng(_selected.feature.geometry.coordinates));
              }
            }
          };

          var scrollSelectedResultIntoView = function () {
            var _selected = self._results.querySelectorAll('.leaflet-pelias-selected')[0];
            var _selectedRect = _selected.getBoundingClientRect();
            var _resultsRect = self._results.getBoundingClientRect();
            // Is the selected element not visible?
            if (_selectedRect.bottom > _resultsRect.bottom) {
              self._results.scrollTop = _selected.offsetTop + _selected.offsetHeight - self._results.offsetHeight;
            } else if (_selectedRect.top < _resultsRect.top) {
              self._results.scrollTop = _selected.offsetTop;
            }
          };

          for (var i = 0; i < list.length; i++) {
            if (list[i] === selected) {
              selectedPosition = i;
              break;
            }
          }

          // TODO cleanup
          switch (e.keyCode) {
            // 13 = enter
            case 13:
              if (selected) {
                this.setSelectedResult(selected, e);
              } else {
                // perform a full text search on enter
                var text = (e.target || e.srcElement).value;
                this.search(text);
              }
              L.DomEvent.preventDefault(e);
              break;
            // 38 = up arrow
            case 38:
              // Ignore key if there are no results or if list is not visible
              if (list.length === 0 || this._results.style.display === 'none') {
                return;
              }

              if (selected) {
                L.DomUtil.removeClass(selected, 'leaflet-pelias-selected');
              }

              var previousItem = list[selectedPosition - 1];
              var highlighted = (selected && previousItem) ? previousItem : list[list.length - 1]; // eslint-disable-line no-redeclare

              L.DomUtil.addClass(highlighted, 'leaflet-pelias-selected');
              scrollSelectedResultIntoView();
              panToPoint(this.options.panToPoint);
              this.fire('highlight', {
                originalEvent: e,
                latlng: L.GeoJSON.coordsToLatLng(highlighted.feature.geometry.coordinates),
                feature: highlighted.feature
              });

              L.DomEvent.preventDefault(e);
              break;
            // 40 = down arrow
            case 40:
              // Ignore key if there are no results or if list is not visible
              if (list.length === 0 || this._results.style.display === 'none') {
                return;
              }

              if (selected) {
                L.DomUtil.removeClass(selected, 'leaflet-pelias-selected');
              }

              var nextItem = list[selectedPosition + 1];
              var highlighted = (selected && nextItem) ? nextItem : list[0]; // eslint-disable-line no-redeclare

              L.DomUtil.addClass(highlighted, 'leaflet-pelias-selected');
              scrollSelectedResultIntoView();
              panToPoint(this.options.panToPoint);
              this.fire('highlight', {
                originalEvent: e,
                latlng: L.GeoJSON.coordsToLatLng(highlighted.feature.geometry.coordinates),
                feature: highlighted.feature
              });

              L.DomEvent.preventDefault(e);
              break;
            // all other keys
            default:
              break;
          }
        }, this)
        .on(this._input, 'keyup', function (e) {
          var key = e.which || e.keyCode;
          var text = (e.target || e.srcElement).value;

          if (text.length > 0) {
            L.DomUtil.removeClass(this._reset, 'leaflet-pelias-hidden');
          } else {
            L.DomUtil.addClass(this._reset, 'leaflet-pelias-hidden');
          }

          // Ignore all further action if the keycode matches an arrow
          // key (handled via keydown event)
          if (key === 13 || key === 38 || key === 40) {
            return;
          }

          // keyCode 27 = esc key (esc should clear results)
          if (key === 27) {
            // If input is blank or results have already been cleared
            // (perhaps due to a previous 'esc') then pressing esc at
            // this point will blur from input as well.
            if (text.length === 0 || this._results.style.display === 'none') {
              this._input.blur();

              if (!this.options.expanded && L.DomUtil.hasClass(this._container, 'leaflet-pelias-expanded')) {
                this.collapse();
              }
            }

            // Clears results
            this.clearResults(true);
            L.DomUtil.removeClass(this._search, 'leaflet-pelias-loading');
            return;
          }

          if (text !== this._lastValue) {
            this._lastValue = text;

            if (text.length >= MINIMUM_INPUT_LENGTH_FOR_AUTOCOMPLETE && this.options.autocomplete === true) {
              this.autocomplete(text);
            } else {
              this.clearResults(true);
            }
          }
        }, this)
        .on(this._results, 'click', function (e) {
          L.DomEvent.preventDefault(e);
          L.DomEvent.stopPropagation(e);

          var _selected = this._results.querySelectorAll('.leaflet-pelias-selected')[0];
          if (_selected) {
            L.DomUtil.removeClass(_selected, 'leaflet-pelias-selected');
          }

          var selected = e.target || e.srcElement; /* IE8 */
          var findParent = function () {
            if (!L.DomUtil.hasClass(selected, 'leaflet-pelias-result')) {
              selected = selected.parentElement;
              if (selected) {
                findParent();
              }
            }
            return selected;
          };

          // click event can be registered on the child nodes
          // that does not have the required coords prop
          // so its important to find the parent.
          findParent();

          // If nothing is selected, (e.g. it's a message, not a result),
          // do nothing.
          if (selected) {
            L.DomUtil.addClass(selected, 'leaflet-pelias-selected');
            this.setSelectedResult(selected, e);
          }
        }, this)
        .on(this._results, 'mouseover', function (e) {
          // Prevent scrolling over results list from zooming the map, if enabled
          this._scrollWheelZoomEnabled = map.scrollWheelZoom.enabled();
          if (this._scrollWheelZoomEnabled) {
            map.scrollWheelZoom.disable();
          }
        }, this)
        .on(this._results, 'mouseout', function (e) {
          // Re-enable scroll wheel zoom (if previously enabled) after
          // leaving the results box
          if (this._scrollWheelZoomEnabled) {
            map.scrollWheelZoom.enable();
          }
        }, this);

      // Recalculate width of the input bar when window resizes
      if (this.options.fullWidth) {
        L.DomEvent.on(window, 'resize', function (e) {
          if (L.DomUtil.hasClass(this._container, 'leaflet-pelias-expanded')) {
            this.setFullWidth();
          }
        }, this);
      }

      L.DomEvent.on(this._map, 'mousedown', this._onMapInteraction, this);
      L.DomEvent.on(this._map, 'touchstart', this._onMapInteraction, this);

      L.DomEvent.disableClickPropagation(this._container);
      if (map.attributionControl) {
        map.attributionControl.addAttribution(this.options.attribution);
      }
      return container;
    },

    _onMapInteraction: function (event) {
      this.blur();

      // Only collapse if the input is clear, and is currently expanded.
      // Disabled if expanded is set to true
      if (!this.options.expanded) {
        if (!this._input.value && L.DomUtil.hasClass(this._container, 'leaflet-pelias-expanded')) {
          this.collapse();
        }
      }
    },

    onRemove: function (map) {
      map.attributionControl.removeAttribution(this.options.attribution);
    }
  });

  L.control.geocoder = function (apiKey, options) {
    return new L.Control.Geocoder(apiKey, options);
  };

  /*
   * AJAX Utility function (implements basic HTTP get)
   */
  var AJAX = {
    serialize: function (params) {
      var data = '';

      for (var key in params) {
        if (params.hasOwnProperty(key)) {
          var param = params[key];
          var type = param.toString();
          var value;

          if (data.length) {
            data += '&';
          }

          switch (type) {
            case '[object Array]':
              value = (param[0].toString() === '[object Object]') ? JSON.stringify(param) : param.join(',');
              break;
            case '[object Object]':
              value = JSON.stringify(param);
              break;
            case '[object Date]':
              value = param.valueOf();
              break;
            default:
              value = param;
              break;
          }

          data += encodeURIComponent(key) + '=' + encodeURIComponent(value);
        }
      }

      return data;
    },
    http_request: function (callback, context) {
      if (window.XDomainRequest) {
        return this.xdr(callback, context);
      } else {
        return this.xhr(callback, context);
      }
    },
    xhr: function (callback, context) {
      var xhr = new XMLHttpRequest();

      xhr.onerror = function (e) {
        xhr.onreadystatechange = L.Util.falseFn;
        var error = {
          code: xhr.status,
          message: xhr.statusText
        };

        callback.call(context, error, null);
      };

      xhr.onreadystatechange = function () {
        var response;
        var error;

        try {
          response = JSON.parse(xhr.responseText);
        } catch (e) {
          response = null;
          error = {
            code: 500,
            message: 'Parse Error'
          };
        }

        if (xhr.readyState === 4) {
          // Handle all non-200 responses first
          if (xhr.status !== 200) {
            error = {
              code: xhr.status,
              message: xhr.statusText
            };
            callback.call(context, error, response);
          } else {
            if (!error && response.error) {
              error = response.error;
            }

            xhr.onerror = L.Util.falseFn;

            callback.call(context, error, response);
          }
        }
      };

      return xhr;
    },
    xdr: function (callback, context) {
      var xdr = new window.XDomainRequest();

      xdr.onerror = function (e) {
        xdr.onload = L.Util.falseFn;

        // XDRs have no access to actual status codes
        var error = {
          code: 500,
          message: 'XMLHttpRequest Error'
        };
        callback.call(context, error, null);
      };

      // XDRs have .onload instead of .onreadystatechange
      xdr.onload = function () {
        var response;
        var error;

        try {
          response = JSON.parse(xdr.responseText);
        } catch (e) {
          response = null;
          error = {
            code: 500,
            message: 'Parse Error'
          };
        }

        if (!error && response.error) {
          error = response.error;
          response = null;
        }

        xdr.onerror = L.Util.falseFn;
        callback.call(context, error, response);
      };

      return xdr;
    },
    request: function (url, params, callback, context) {
      var paramString = this.serialize(params);
      var httpRequest = this.http_request(callback, context);

      httpRequest.open('GET', url + '?' + paramString);
      if (httpRequest.constructor.name === 'XMLHttpRequest') {
        httpRequest.setRequestHeader('Accept', 'application/json');
      }

      setTimeout(function () {
        httpRequest.send(null);
      }, 0);
    }
  };

  /*
   * throttle Utility function (borrowed from underscore)
   */
  function throttle (func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    if (!options) options = {};
    var later = function () {
      previous = options.leading === false ? 0 : new Date().getTime();
      timeout = null;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    };
    return function () {
      var now = new Date().getTime();
      if (!previous && options.leading === false) previous = now;
      var remaining = wait - (now - previous);
      context = this;
      args = arguments;
      if (remaining <= 0 || remaining > wait) {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        previous = now;
        result = func.apply(context, args);
        if (!timeout) context = args = null;
      } else if (!timeout && options.trailing !== false) {
        timeout = setTimeout(later, remaining);
      }
      return result;
    };
  }

  /*
   * escaping a string for regex Utility function
   * from https://stackoverflow.com/questions/3446170/escape-string-for-use-in-javascript-regex
   */
  function escapeRegExp (str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
  }
}));

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],2:[function(require,module,exports){
(function (global){
/*!
Copyright (c) 2016 Dominik Moritz

This file is part of the leaflet locate control. It is licensed under the MIT license.
You can find the project at: https://github.com/domoritz/leaflet-locatecontrol
*/
(function (factory, window) {
     // see https://github.com/Leaflet/Leaflet/blob/master/PLUGIN-GUIDE.md#module-loaders
     // for details on how to structure a leaflet plugin.

    // define an AMD module that relies on 'leaflet'
    if (typeof define === 'function' && define.amd) {
        define(['leaflet'], factory);

    // define a Common JS module that relies on 'leaflet'
    } else if (typeof exports === 'object') {
        if (typeof window !== 'undefined' && window.L) {
            module.exports = factory(L);
        } else {
            module.exports = factory((typeof window !== "undefined" ? window['L'] : typeof global !== "undefined" ? global['L'] : null));
        }
    }

    // attach your plugin to the global 'L' variable
    if (typeof window !== 'undefined' && window.L){
        window.L.Control.Locate = factory(L);
    }
} (function (L) {
    var LocateControl = L.Control.extend({
        options: {
            /** Position of the control */
            position: 'topleft',
            /** The layer that the user's location should be drawn on. By default creates a new layer. */
            layer: undefined,
            /**
             * Automatically sets the map view (zoom and pan) to the user's location as it updates.
             * While the map is following the user's location, the control is in the `following` state,
             * which changes the style of the control and the circle marker.
             *
             * Possible values:
             *  - false: never updates the map view when location changes.
             *  - 'once': set the view when the location is first determined
             *  - 'always': always updates the map view when location changes.
             *              The map view follows the users location.
             *  - 'untilPan': (default) like 'always', except stops updating the
             *                view if the user has manually panned the map.
             *                The map view follows the users location until she pans.
             */
            setView: 'untilPan',
            /** Keep the current map zoom level when setting the view and only pan. */
            keepCurrentZoomLevel: false,
            /** Smooth pan and zoom to the location of the marker. Only works in Leaflet 1.0+. */
            flyTo: false,
            /**
             * The user location can be inside and outside the current view when the user clicks on the
             * control that is already active. Both cases can be configures separately.
             * Possible values are:
             *  - 'setView': zoom and pan to the current location
             *  - 'stop': stop locating and remove the location marker
             */
            clickBehavior: {
                /** What should happen if the user clicks on the control while the location is within the current view. */
                inView: 'stop',
                /** What should happen if the user clicks on the control while the location is outside the current view. */
                outOfView: 'setView',
            },
            /**
             * If set, save the map bounds just before centering to the user's
             * location. When control is disabled, set the view back to the
             * bounds that were saved.
             */
            returnToPrevBounds: false,
            /**
             * Keep a cache of the location after the user deactivates the control. If set to false, the user has to wait
             * until the locate API returns a new location before they see where they are again.
             */
            cacheLocation: true,
            /** If set, a circle that shows the location accuracy is drawn. */
            drawCircle: true,
            /** If set, the marker at the users' location is drawn. */
            drawMarker: true,
            /** The class to be used to create the marker. For example L.CircleMarker or L.Marker */
            markerClass: L.CircleMarker,
            /** Accuracy circle style properties. */
            circleStyle: {
                color: '#136AEC',
                fillColor: '#136AEC',
                fillOpacity: 0.15,
                weight: 2,
                opacity: 0.5
            },
            /** Inner marker style properties. Only works if your marker class supports `setStyle`. */
            markerStyle: {
                color: '#136AEC',
                fillColor: '#2A93EE',
                fillOpacity: 0.7,
                weight: 2,
                opacity: 0.9,
                radius: 5
            },
            /**
             * Changes to accuracy circle and inner marker while following.
             * It is only necessary to provide the properties that should change.
             */
            followCircleStyle: {},
            followMarkerStyle: {
                // color: '#FFA500',
                // fillColor: '#FFB000'
            },
            /** The CSS class for the icon. For example fa-location-arrow or fa-map-marker */
            icon: 'fa fa-map-marker',
            iconLoading: 'fa fa-spinner fa-spin',
            /** The element to be created for icons. For example span or i */
            iconElementTag: 'span',
            /** Padding around the accuracy circle. */
            circlePadding: [0, 0],
            /** Use metric units. */
            metric: true,
            /** This event is called in case of any location error that is not a time out error. */
            onLocationError: function(err, control) {
                alert(err.message);
            },
            /**
             * This even is called when the user's location is outside the bounds set on the map.
             * The event is called repeatedly when the location changes.
             */
            onLocationOutsideMapBounds: function(control) {
                control.stop();
                alert(control.options.strings.outsideMapBoundsMsg);
            },
            /** Display a pop-up when the user click on the inner marker. */
            showPopup: true,
            strings: {
                title: "Show me where I am",
                metersUnit: "meters",
                feetUnit: "feet",
                popup: "You are within {distance} {unit} from this point",
                outsideMapBoundsMsg: "You seem located outside the boundaries of the map"
            },
            /** The default options passed to leaflets locate method. */
            locateOptions: {
                maxZoom: Infinity,
                watch: true,  // if you overwrite this, visualization cannot be updated
                setView: false // have to set this to false because we have to
                               // do setView manually
            }
        },

        initialize: function (options) {
            // set default options if nothing is set (merge one step deep)
            for (var i in options) {
                if (typeof this.options[i] === 'object') {
                    L.extend(this.options[i], options[i]);
                } else {
                    this.options[i] = options[i];
                }
            }

            // extend the follow marker style and circle from the normal style
            this.options.followMarkerStyle = L.extend({}, this.options.markerStyle, this.options.followMarkerStyle);
            this.options.followCircleStyle = L.extend({}, this.options.circleStyle, this.options.followCircleStyle);
        },

        /**
         * Add control to map. Returns the container for the control.
         */
        onAdd: function (map) {
            var container = L.DomUtil.create('div',
                'leaflet-control-locate leaflet-bar leaflet-control');

            this._layer = this.options.layer || new L.LayerGroup();
            this._layer.addTo(map);
            this._event = undefined;
            this._prevBounds = null;

            this._link = L.DomUtil.create('a', 'leaflet-bar-part leaflet-bar-part-single', container);
            this._link.title = this.options.strings.title;
            this._icon = L.DomUtil.create(this.options.iconElementTag, this.options.icon, this._link);

            L.DomEvent
                .on(this._link, 'click', L.DomEvent.stopPropagation)
                .on(this._link, 'click', L.DomEvent.preventDefault)
                .on(this._link, 'click', this._onClick, this)
                .on(this._link, 'dblclick', L.DomEvent.stopPropagation);

            this._resetVariables();

            this._map.on('unload', this._unload, this);

            return container;
        },

        /**
         * This method is called when the user clicks on the control.
         */
        _onClick: function() {
            this._justClicked = true;
            this._userPanned = false;

            if (this._active && !this._event) {
                // click while requesting
                this.stop();
            } else if (this._active && this._event !== undefined) {
                var behavior = this._map.getBounds().contains(this._event.latlng) ?
                    this.options.clickBehavior.inView : this.options.clickBehavior.outOfView;
                switch (behavior) {
                    case 'setView':
                        this.setView();
                        break;
                    case 'stop':
                        this.stop();
                        if (this.options.returnToPrevBounds) {
                            var f = this.options.flyTo ? this._map.flyToBounds : this._map.fitBounds;
                            f.bind(this._map)(this._prevBounds);
                        }
                        break;
                }
            } else {
                if (this.options.returnToPrevBounds) {
                  this._prevBounds = this._map.getBounds();
                }
                this.start();
            }

            this._updateContainerStyle();
        },

        /**
         * Starts the plugin:
         * - activates the engine
         * - draws the marker (if coordinates available)
         */
        start: function() {
            this._activate();

            if (this._event) {
                this._drawMarker(this._map);

                // if we already have a location but the user clicked on the control
                if (this.options.setView) {
                    this.setView();
                }
            }
            this._updateContainerStyle();
        },

        /**
         * Stops the plugin:
         * - deactivates the engine
         * - reinitializes the button
         * - removes the marker
         */
        stop: function() {
            this._deactivate();

            this._cleanClasses();
            this._resetVariables();

            this._removeMarker();
        },

        /**
         * This method launches the location engine.
         * It is called before the marker is updated,
         * event if it does not mean that the event will be ready.
         *
         * Override it if you want to add more functionalities.
         * It should set the this._active to true and do nothing if
         * this._active is true.
         */
        _activate: function() {
            if (!this._active) {
                this._map.locate(this.options.locateOptions);
                this._active = true;

                // bind event listeners
                this._map.on('locationfound', this._onLocationFound, this);
                this._map.on('locationerror', this._onLocationError, this);
                this._map.on('dragstart', this._onDrag, this);
            }
        },

        /**
         * Called to stop the location engine.
         *
         * Override it to shutdown any functionalities you added on start.
         */
        _deactivate: function() {
            this._map.stopLocate();
            this._active = false;

            if (!this.options.cacheLocation) {
                this._event = undefined;
            }

            // unbind event listeners
            this._map.off('locationfound', this._onLocationFound, this);
            this._map.off('locationerror', this._onLocationError, this);
            this._map.off('dragstart', this._onDrag, this);
        },

        /**
         * Zoom (unless we should keep the zoom level) and an to the current view.
         */
        setView: function() {
            this._drawMarker();
            if (this._isOutsideMapBounds()) {
                this._event = undefined;  // clear the current location so we can get back into the bounds
                this.options.onLocationOutsideMapBounds(this);
            } else {
                if (this.options.keepCurrentZoomLevel) {
                    var f = this.options.flyTo ? this._map.flyTo : this._map.panTo;
                    f.bind(this._map)([this._event.latitude, this._event.longitude]);
                } else {
                    var f = this.options.flyTo ? this._map.flyToBounds : this._map.fitBounds;
                    f.bind(this._map)(this._event.bounds, {
                        padding: this.options.circlePadding,
                        maxZoom: this.options.locateOptions.maxZoom
                    });
                }
            }
        },

        /**
         * Draw the marker and accuracy circle on the map.
         *
         * Uses the event retrieved from onLocationFound from the map.
         */
        _drawMarker: function() {
            if (this._event.accuracy === undefined) {
                this._event.accuracy = 0;
            }

            var radius = this._event.accuracy;
            var latlng = this._event.latlng;

            // circle with the radius of the location's accuracy
            if (this.options.drawCircle) {
                var style = this._isFollowing() ? this.options.followCircleStyle : this.options.circleStyle;

                if (!this._circle) {
                    this._circle = L.circle(latlng, radius, style).addTo(this._layer);
                } else {
                    this._circle.setLatLng(latlng).setRadius(radius).setStyle(style);
                }
            }

            var distance, unit;
            if (this.options.metric) {
                distance = radius.toFixed(0);
                unit =  this.options.strings.metersUnit;
            } else {
                distance = (radius * 3.2808399).toFixed(0);
                unit = this.options.strings.feetUnit;
            }

            // small inner marker
            if (this.options.drawMarker) {
                var mStyle = this._isFollowing() ? this.options.followMarkerStyle : this.options.markerStyle;
                if (!this._marker) {
                    this._marker = new this.options.markerClass(latlng, mStyle).addTo(this._layer);
                } else {
                    this._marker.setLatLng(latlng);
                    // If the markerClass can be updated with setStyle, update it.
                    if (this._marker.setStyle) {
                        this._marker.setStyle(mStyle);
                    }
                }
            }

            var t = this.options.strings.popup;
            if (this.options.showPopup && t && this._marker) {
                this._marker
                    .bindPopup(L.Util.template(t, {distance: distance, unit: unit}))
                    ._popup.setLatLng(latlng);
            }
        },

        /**
         * Remove the marker from map.
         */
        _removeMarker: function() {
            this._layer.clearLayers();
            this._marker = undefined;
            this._circle = undefined;
        },

        /**
         * Unload the plugin and all event listeners.
         * Kind of the opposite of onAdd.
         */
        _unload: function() {
            this.stop();
            this._map.off('unload', this._unload, this);
        },

        /**
         * Calls deactivate and dispatches an error.
         */
        _onLocationError: function(err) {
            // ignore time out error if the location is watched
            if (err.code == 3 && this.options.locateOptions.watch) {
                return;
            }

            this.stop();
            this.options.onLocationError(err, this);
        },

        /**
         * Stores the received event and updates the marker.
         */
        _onLocationFound: function(e) {
            // no need to do anything if the location has not changed
            if (this._event &&
                (this._event.latlng.lat === e.latlng.lat &&
                 this._event.latlng.lng === e.latlng.lng &&
                     this._event.accuracy === e.accuracy)) {
                return;
            }

            if (!this._active) {
                // we may have a stray event
                return;
            }

            this._event = e;

            this._drawMarker();
            this._updateContainerStyle();

            switch (this.options.setView) {
                case 'once':
                    if (this._justClicked) {
                        this.setView();
                    }
                    break;
                case 'untilPan':
                    if (!this._userPanned) {
                        this.setView();
                    }
                    break;
                case 'always':
                    this.setView();
                    break;
                case false:
                    // don't set the view
                    break;
            }

            this._justClicked = false;
        },

        /**
         * When the user drags. Need a separate even so we can bind and unbind even listeners.
         */
        _onDrag: function() {
            // only react to drags once we have a location
            if (this._event) {
                this._userPanned = true;
                this._updateContainerStyle();
                this._drawMarker();
            }
        },

        /**
         * Compute whether the map is following the user location with pan and zoom.
         */
        _isFollowing: function() {
            if (!this._active) {
                return false;
            }

            if (this.options.setView === 'always') {
                return true;
            } else if (this.options.setView === 'untilPan') {
                return !this._userPanned;
            }
        },

        /**
         * Check if location is in map bounds
         */
        _isOutsideMapBounds: function() {
            if (this._event === undefined) {
                return false;
            }
            return this._map.options.maxBounds &&
                !this._map.options.maxBounds.contains(this._event.latlng);
        },

        /**
         * Toggles button class between following and active.
         */
        _updateContainerStyle: function() {
            if (!this._container) {
                return;
            }

            if (this._active && !this._event) {
                // active but don't have a location yet
                this._setClasses('requesting');
            } else if (this._isFollowing()) {
                this._setClasses('following');
            } else if (this._active) {
                this._setClasses('active');
            } else {
                this._cleanClasses();
            }
        },

        /**
         * Sets the CSS classes for the state.
         */
        _setClasses: function(state) {
            if (state == 'requesting') {
                L.DomUtil.removeClasses(this._container, "active following");
                L.DomUtil.addClasses(this._container, "requesting");

                L.DomUtil.removeClasses(this._icon, this.options.icon);
                L.DomUtil.addClasses(this._icon, this.options.iconLoading);
            } else if (state == 'active') {
                L.DomUtil.removeClasses(this._container, "requesting following");
                L.DomUtil.addClasses(this._container, "active");

                L.DomUtil.removeClasses(this._icon, this.options.iconLoading);
                L.DomUtil.addClasses(this._icon, this.options.icon);
            } else if (state == 'following') {
                L.DomUtil.removeClasses(this._container, "requesting");
                L.DomUtil.addClasses(this._container, "active following");

                L.DomUtil.removeClasses(this._icon, this.options.iconLoading);
                L.DomUtil.addClasses(this._icon, this.options.icon);
            }
        },

        /**
         * Removes all classes from button.
         */
        _cleanClasses: function() {
            L.DomUtil.removeClass(this._container, "requesting");
            L.DomUtil.removeClass(this._container, "active");
            L.DomUtil.removeClass(this._container, "following");

            L.DomUtil.removeClasses(this._icon, this.options.iconLoading);
            L.DomUtil.addClasses(this._icon, this.options.icon);
        },

        /**
         * Reinitializes state variables.
         */
        _resetVariables: function() {
            // whether locate is active or not
            this._active = false;

            // true if the control was clicked for the first time
            // we need this so we can pan and zoom once we have the location
            this._justClicked = false;

            // true if the user has panned the map after clicking the control
            this._userPanned = false;
        }
    });

    L.control.locate = function (options) {
        return new L.Control.Locate(options);
    };

    (function(){
      // leaflet.js raises bug when trying to addClass / removeClass multiple classes at once
      // Let's create a wrapper on it which fixes it.
      var LDomUtilApplyClassesMethod = function(method, element, classNames) {
        classNames = classNames.split(' ');
        classNames.forEach(function(className) {
            L.DomUtil[method].call(this, element, className);
        });
      };

      L.DomUtil.addClasses = function(el, names) { LDomUtilApplyClassesMethod('addClass', el, names); };
      L.DomUtil.removeClasses = function(el, names) { LDomUtilApplyClassesMethod('removeClass', el, names); };
    })();

    return LocateControl;
}, window));

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],3:[function(require,module,exports){
// (c) 2017 Mapzen
//
// MAPZEN SCARAB (aka BUG for US BROADCAST TELEVISION and DOG in the UK)
// http://en.wikipedia.org/wiki/Digital_on-screen_graphic
//
// Identifies full-screen demo pages with Mapzen brand and provides helpful
// social media links.
// ----------------------------------------------------------------------------
/* global module, ga */
var MapzenScarab = (function () {
  'use strict'

  var DEFAULT_LINK = 'https://mapzen.com/'
  var TRACKING_CATEGORY = 'demo'
  var ANALYTICS_PROPERTY_ID = 'UA-47035811-1'

  // Globals
  var opts
    // opts.name      Name of demo
    // opts.link      Link to go to
    // opts.tweet     prewritten tweet
    // opts.analytics track?
    // opts.repo      Link to GitHub repository
    // opts.description Information about map

  var infoDescriptionEl

  function _track (action, label, value, nonInteraction) {
    if (opts.analytics === false) return false

    if (typeof ga === 'undefined') {
      return false
    }

    ga('send', 'event', TRACKING_CATEGORY, action, label, value, nonInteraction)
  }

  function _loadAnalytics () {
    /* eslint-disable */
    (function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
    (i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
    m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
    })(window,document,'script','//www.google-analytics.com/analytics.js','ga');

    ga('create', ANALYTICS_PROPERTY_ID, 'auto');
    ga('send', 'pageview');
    /* eslint-enable */
  }

  function _popupWindow (url, title, w, h) {
    // Borrowed from rrssb
    // Fixes dual-screen position                         Most browsers      Firefox
    var dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : window.screen.left
    var dualScreenTop = window.screenTop !== undefined ? window.screenTop : window.screen.top

    var width = window.innerWidth ? window.innerWidth : document.documentElement.clientWidth ? document.documentElement.clientWidth : window.screen.width
    var height = window.innerHeight ? window.innerHeight : document.documentElement.clientHeight ? document.documentElement.clientHeight : window.screen.height

    var left = ((width / 2) - (w / 2)) + dualScreenLeft
    var top = ((height / 3) - (h / 3)) + dualScreenTop

    var newWindow = window.open(url, title, 'scrollbars=yes, width=' + w + ', height=' + h + ', top=' + top + ', left=' + left)

    // Puts focus on the newWindow
    if (window.focus) {
      newWindow.focus()
    }
  }

  function _buildTwitterLink () {
    var base = 'https://twitter.com/intent/tweet'
    var url = encodeURIComponent(window.location.href)
    var text
    var params

    if (opts.tweet) {
      text = encodeURIComponent(opts.tweet)
    } else if (opts.name) {
      text = encodeURIComponent(opts.name + ', powered by @mapzen')
    } else {
      text = encodeURIComponent('Check out this project by @mapzen!')
    }

    params = '?text=' + text + '&url=' + url
    return base + params
  }

  function _buildFacebookLink () {
    var base = 'https://www.facebook.com/sharer/sharer.php?u='
    var url = encodeURIComponent(window.location.href)
    return base + url
  }

  function _createElsAndAppend () {
    var mapzenLink = opts.link || DEFAULT_LINK
    var mapzenTitle = (opts.name) ? opts.name + ' · Powered by Mapzen' : 'Powered by Mapzen'
    var el = document.createElement('div')

    // Create container
    el.id = 'mz-bug'
    el.className = 'mz-bug-container'
    el.setAttribute('role', 'widget')

    // Create buttons
    var mapzenEl = _createButtonEl('mapzen', mapzenLink, mapzenTitle, _onClickMapzen)
    var twitterEl = _createButtonEl('twitter', _buildTwitterLink(), 'Share this on Twitter', _onClickTwitter)
    var facebookEl = _createButtonEl('facebook', _buildFacebookLink(), 'Share this on Facebook', _onClickFacebook)

    // Build DOM
    el.appendChild(mapzenEl)
    el.appendChild(twitterEl)
    el.appendChild(facebookEl)

    // Creating github icon button if needed
    if (opts.repo) {
      var githubEl = _createButtonEl('github', opts.repo, 'View source on GitHub', _onClickGitHub)
      el.appendChild(githubEl)
    }

    // Creating info button and adding to container only if description is provided
    if (opts.description) {
      var infoEl = _createInfoButton('info', _onClickInfo)
      el.appendChild(infoEl)
    }

    document.body.appendChild(el)
    return el
  }

  function _createInfoButton(id, clickHandler) {
    var infoButton = document.createElement('div')
    var infoLogo = document.createElement('div')
    infoLogo.className = 'mz-bug-' + id + '-logo'
    infoLogo.addEventListener('click', clickHandler)
    infoButton.className = 'mz-bug-' + id
    infoButton.className += ' mz-bug-icons'

    infoButton.appendChild(infoLogo)
    return infoButton
  }

  function _createButtonEl (id, linkHref, linkTitle, clickHandler) {
    var linkEl = document.createElement('a')
    var logoEl = document.createElement('div')

    logoEl.className = 'mz-bug-' + id + '-logo'
    linkEl.href = linkHref
    linkEl.target = '_blank'
    linkEl.className = 'mz-bug-' + id + '-link'
    linkEl.className += ' mz-bug-icons'
    linkEl.title = linkTitle
    linkEl.addEventListener('click', clickHandler)

    linkEl.appendChild(logoEl)
    return linkEl
  }

  function _onClickMapzen (event) {
    _track('click', 'mapzen logo', opts.name)
  }

  function _onClickTwitter (event) {
    event.preventDefault()
    var link = _buildTwitterLink()
    _popupWindow(link, 'Twitter', 580, 470)
    _track('click', 'twitter', opts.name)
  }

  function _onClickFacebook (event) {
    event.preventDefault()
    var link = _buildFacebookLink()
    _popupWindow(link, 'Facebook', 580, 470)
    _track('click', 'facebook', opts.name)
  }

  function _onClickGitHub (event) {
    _track('click', 'github', opts.name)
  }

  // Clicking info button should lead to pop up description to open up
  // Clicking info button again should lead to description box closing
  // If no description provided, do not open description box
  function _onClickInfo(event) {
    var elem = infoDescriptionEl
    if (elem.style.display === 'block') {
      elem.style.display = 'none'
    } else {
      elem.style.display = 'block'
    }
  }

  function _buildDescription(id, container) {
    var infoBox = document.createElement('div')
    infoBox.className = "mz-bug-" + id
    infoBox.textContent = opts.description 
    infoBox.style.width = container.offsetWidth + 'px'
    infoBox.style.marginLeft = container.style.marginLeft

    document.body.appendChild(infoBox)
    return infoBox
  }

  function resizeDescription(container) {
    var containerWidth = container.offsetWidth 
    infoDescriptionEl.style.width = containerWidth + 'px'
    infoDescriptionEl.style.marginLeft = container.style.marginLeft
  }

  function centerScarab(container) {
    var containerWidth = container.offsetWidth
    var offsetMargin = -1 * containerWidth / 2
    container.style.marginLeft = offsetMargin + 'px'
  }

  var MapzenScarab = function (options) {
    // nifty JS constructor pattern via browserify documentation
    // https://github.com/substack/browserify-handbook#reusable-components
    if (!(this instanceof MapzenScarab)) return new MapzenScarab(options)

    // If iframed, exit & do nothing.
    if (window.self !== window.top) {
      return false
    }

    this.setOptions(options)

    this.el = _createElsAndAppend()
    this.twitterEl = this.el.querySelector('.mz-bug-twitter-link')
    this.facebookEl = this.el.querySelector('.mz-bug-facebook-link')

    centerScarab(this.el);
    window.addEventListener('resize', function(event) {
      centerScarab(this.el)
    }.bind(this))

    // Build links
    this.rebuildLinks()
    // Rebuild links if hash changes
    window.onhashchange = function () {
      this.rebuildLinks()
    }.bind(this)

    if (opts.description) {
      infoDescriptionEl = _buildDescription('description', this.el)
      window.addEventListener('resize', function(event) {
        resizeDescription(this.el)
      }.bind(this))
    }

    // Check if Google Analytics is present soon in the future; if not, load it.
    window.setTimeout(function () {
      if (typeof ga === 'undefined') {
        _loadAnalytics()
        _track('analytics', 'fallback', null, true)
      }

      _track('bug', 'active', opts.name, true)
    }, 0)
  }

  MapzenScarab.prototype.rebuildLinks = function () {
    this.twitterEl.href = _buildTwitterLink()
    this.facebookEl.href = _buildFacebookLink()
  }

  MapzenScarab.prototype.hide = function () {
    this.el.style.display = 'none'
  }

  MapzenScarab.prototype.show = function () {
    this.el.style.display = 'block'
  }

  MapzenScarab.prototype.setOptions = function (options) {
    // Default options
    opts = opts || {
      analytics: true,
      name: null
    }

    // Copy options values
    if (typeof options === 'object') {
      for (var i in options) {
        opts[i] = options[i]
      }
    }

    this.opts = opts
  }

  return MapzenScarab
}())

// Export as browserify module if present, otherwise, it is global to window
if (typeof module === 'object' && typeof module.exports === 'object') {
  module.exports = MapzenScarab
} else {
  window.MapzenScarab = MapzenScarab
}

},{}],4:[function(require,module,exports){
// (c) 2015 Mapzen
//
// MAP UI · GEOLOCATOR v2
//
// "Locate me" button for demos
// ----------------------------------------------------------------------------
module.exports = {
  init: function (options, map) {
    /* global map */
    'use strict'

    // Handle `options` parameter
    // If `options` is undefined, make it an empty object
    // If `options` is boolean, set options.show property
    // This allows for future syntax where options is an object
    if (options === true) {
      options = {
        show: true
      }
    } else if (options === false) {
      options = {
        show: false
      }
    } else if (typeof options === 'undefined') {
      options = {}
    }

    // Exit if demo is iframed & not forced to be turned on
    if (window.self !== window.top && options.show !== true) return false

    // Exit if forced to be turned off
    if (options.show === false) return false

    require('leaflet.locatecontrol')

    // Geolocator
    var locator = L.control.locate({
      drawCircle: false,
      follow: false,
      showPopup: false,
      drawMarker: false,
      markerStyle: {
        opacity: 0,
      },
      strings: {
        title: 'Get current location'
      },
      icon: 'mz-geolocator-icon',
      // We piggy back on geocoder plugin styles and use their load icon so it is the same.
      // Re-using the class name means we don't duplicate the embedded image style in the compiled bundle.
      iconLoading: 'mz-geolocator-icon mz-geolocator-active leaflet-pelias-search-icon leaflet-pelias-loading'
    }).addTo(map)

    // Re-sort control order so that locator is on top
    // locator._container is a reference to the locator's DOM element.
    locator._container.parentNode.insertBefore(locator._container, locator._container.parentNode.childNodes[0])
  }
}

},{"leaflet.locatecontrol":2}],5:[function(require,module,exports){
// (c) 2015 Mapzen
//
// MAP UI · MAPZEN SEARCH
//
// ----------------------------------------------------------------------------
module.exports = {
  init: function (options, map) {
    /* global map */
    'use strict'

    // Handle `options` parameter
    // If `options` is undefined, make it an empty object
    // If `options` is boolean, set options.show property
    // This allows for future syntax where options is an object
    if (options === true) {
      options = {
        show: true
      }
    } else if (options === false) {
      options = {
        show: false
      }
    } else if (typeof options === 'undefined') {
      options = {}
    }

    // Exit if demo is iframed & not forced to be turned on
    if (window.self !== window.top && options.show !== true) return false

    // Exit if forced to be turned off
    if (options.show === false) return false

    require('leaflet-geocoder-mapzen')

    var DEMO_API_KEY = 'search-PFZ8iFx'

    var geocoderOptions = {
      expanded: true,
      layers: ['coarse'],
      placeholder: 'Search for city',
      title: 'Search for city',
      pointIcon: false,
      polygonIcon: false,
      markers: false,
      params: {
        // TODO: remove geonames after WOF incorporates cities & Pelias includes alt-name search
        sources: 'wof,gn'
      }
    }

    var geocoder = L.control.geocoder(DEMO_API_KEY, geocoderOptions).addTo(map)

    // Re-sort control order so that geocoder is on top
    // geocoder._container is a reference to the geocoder's DOM element.
    geocoder._container.parentNode.insertBefore(geocoder._container, geocoder._container.parentNode.childNodes[0])

    // Handle when viewport is smaller
    window.addEventListener('resize', checkResize)
    checkResize() // Check on load

    var isListening = false
    var previousWidth = getViewportWidth()

    function getViewportWidth () {
      return window.innerWidth ? window.innerWidth : document.documentElement.clientWidth ? document.documentElement.clientWidth : window.screen.width
    }

    function checkResize (event) {
      var width = getViewportWidth()

      // don't do anything if the WIDTH has not changed.
      if (width === previousWidth) return

      if (width < 900) {
        // Do these checks to make sure collapse / expand events don't fire continuously
        if (L.DomUtil.hasClass(geocoder._container, 'leaflet-pelias-expanded')) {
          geocoder.collapse()
          map.off('mousedown', geocoder.collapse.bind(geocoder))
          isListening = false
        }
      } else {
        if (!L.DomUtil.hasClass(geocoder._container, 'leaflet-pelias-expanded')) {
          geocoder.expand()
          // Make sure only one of these are listening
          if (isListening === false) {
            map.on('mousedown', geocoder.collapse.bind(geocoder))
            isListening = true
          }
        }
      }

      previousWidth = width
    }

    geocoder.on('expand', function (event) {
      if (isListening === false) {
        map.on('mousedown', geocoder.collapse.bind(geocoder))
        isListening = true
      }
    })
  }
}

},{"leaflet-geocoder-mapzen":1}],6:[function(require,module,exports){
// (c) 2015 Mapzen
//
// UTILS · IFRAMED ANCHOR TARGETS
//
// Bottom line is, don’t use target="_blank" in anchors.
// Read more: https://css-tricks.com/use-target_blank/
//
// If you’re in an iframe, though, you may not want links to open within the
// frame. The following code snippet will add target="_top" to all links that
// do not have an explicit target attribute. You may force target="_blank" to
// be target="_top" by passing an optional parameter of "true".
//
// Recommended use: run this function in a check for iframed status, e.g.
//     if (window.self !== window.top) anchorTargets(true)
//
// If this is being run with Leaflet, run this after the map is initialized
// to make sure all attribution links open in the parent tab / window.
// ----------------------------------------------------------------------------
module.exports = function (force) {
  'use strict'

  var anchors = document.querySelectorAll('a')

  for (var i = 0, j = anchors.length; i < j; i++) {
    var el = anchors[i]

    // Only set target when not explicitly specified
    // to avoid overwriting intentional targeting behavior
    // Unless the force parameter is true, then targets of
    // '_blank' are forced to to be '_top'
    if (!el.target || (force === true && el.target === '_blank')) {
      el.target = '_top'
    }
  }
}

},{}],7:[function(require,module,exports){
// (c) 2015 Mapzen
//
// MAP UI · CONDITIONALLY DISPLAYED ZOOM BUTTONS
//
//                     · A POEM ·
//
// Where there is a map,
// On touch-enabled devices
//
// The zoom controls are unnecessary -
//                They clutter the UI.
//
// Therefore,
// They should be disabled.
//
//                     ·  FIN  ·
//
// Additional notes:
//  - We don’t need to care whether zoom is enabled or not on the map.
//  - It doesn’t matter what the viewport / device dimensions are.
//  - Touch detection is flaky. See this discussion:
//    http://www.stucox.com/blog/you-cant-detect-a-touchscreen/
//    That said, we’ll attempt to capture more frequent
//    use cases and leave zoom buttons in place otherwise.
// ----------------------------------------------------------------------------
/* global Modernizr, map */

var DEBUG = true

function debug (message) {
  if (DEBUG === true) {
    console.log('MPZN ZoomControl: ' + message)
  }
}

module.exports = function () {
  'use strict'

  // Assumes a global `map` object
  // TODO: Ask for object explicitly
  var mapRef = map || null
  var isProbablyTouchscreen

  debug('Conditional zoom control active.')

  // Are we in a touch-screen environment?
  // Check if Modernizr is present and detecting touch
  // Modernizr might be present, but not performing a touch test, so do our own sniff test also
  // TODO: Require Modernizr?
  if ((typeof Modernizr === 'object' && Modernizr.hasOwnProperty('touch') && Modernizr.touch === true) || 'ontouchstart' in window) {
    isProbablyTouchscreen = true
  }

  // Overrides the zoom container element display style
  // TODO: Provide functionality for other map libraries
  if (isProbablyTouchscreen === true) {
    debug('Touchscreen detected.')
    // Double check that it is Leaflet
    if (typeof mapRef === 'object' && mapRef.hasOwnProperty('_leaflet_id')) {
      debug('Leaflet detected, hiding zoom control.')
      mapRef.zoomControl._container.style.display = 'none'
    }
  } else {
    debug('No touchscreen detected, exiting.')
  }
}

},{}],8:[function(require,module,exports){
// (c) 2015-2016 Mapzen
//
// MAPZEN UI BUNDLE
//
// Requires everything via browserify
// ----------------------------------------------------------------------------
/* global require, module */
'use strict'

var Bug = require('mapzen-scarab')
var search = require('./components/search/search')
var geolocator = require('./components/geolocator/geolocator')
var zoomControl = require('./components/utils/zoom-control')
var anchorTargets = require('./components/utils/anchor-targets')

// To avoid making an external request for styles (which results in an ugly
// Flash of Unstyled Content) we're going to inline all the styles into
// this JS file. This is done by taking the minified, concatenated CSS and
// inserting it via mustache in this variable here:
var css = '.mz-bug-description{display:none;box-sizing:border-box;background-color:hsla(0,0%,100%,.9);box-shadow:0 0 10px 1px rgba(0,0,0,.2);text-align:center;position:absolute;top:75px;left:50%;z-index:900;padding:10px;border-radius:5px;border:0 solid #000}.mz-bug-container,.mz-bug-container *{box-sizing:content-box}.mz-bug-container{position:absolute;top:0;left:50%;height:48px;background-color:hsla(0,0%,100%,.9);box-shadow:0 0 10px 1px rgba(0,0,0,.2);overflow:hidden;z-index:900;border-bottom-left-radius:5px;border-bottom-right-radius:5px}.mz-bug-icons{float:left;height:100%;transition:box-shadow .16s ease-in-out,background-color .16s linear}.mz-bug-container a:focus{outline:1px dotted;outline-offset:-1px}.mz-bug-mapzen-link{display:block;width:144px}.mz-bug-mapzen-link:active,.mz-bug-mapzen-link:hover{background:#fff;box-shadow:inset 0 -4px 0 #635378}.mz-bug-mapzen-logo{background-image:url("data:image/png;base64,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");background-repeat:no-repeat;background-size:100%;width:100%;height:100%;margin-top:-1px}@media only screen and (max-width:400px){.mz-bug-mapzen-link{width:48px}.mz-bug-mapzen-logo{background-size:144px;margin-left:-3px}}@media (-webkit-min-device-pixel-ratio:2),(min-resolution:192dpi){.mz-bug-mapzen-logo{background-image:url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASAAAABgCAMAAACKcl9qAAAC/VBMVEX///9cTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmpcTmrjJjUkAAAA/3RSTlMATRzfaP8rs3YJ9sFL/BFBBJZZDzTvpVbhpCBuvPuw8/q7bB8t7QMBNYTRrPDQgXk8CJnm/aAeEuWDgpdKB8SHFWCv9fm6ax2eIcByJOCQbU8T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")}}.mz-bug-twitter-link{width:48px;height:48px;border-left:1px solid rgba(0,0,0,.1)}.mz-bug-twitter-link:active,.mz-bug-twitter-link:hover{background:#fff;box-shadow:inset 0 -4px 0 #2aa9e0}.mz-bug-twitter-logo{background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'28\' height=\'28\' viewBox=\'0 0 28 28\'%3E%3Cpath d=\'M24.253 8.756C24.69 17.08 18.297 24.182 9.97 24.62a15.086 15.086 0 0 1-8.86-2.32c2.702.18 5.375-.648 7.507-2.32a5.421 5.421 0 0 1-4.49-3.64c.802.13 1.62.077 2.4-.154a5.416 5.416 0 0 1-4.412-5.11 5.412 5.412 0 0 0 2.168.387 5.415 5.415 0 0 1-1.394-6.965 15.084 15.084 0 0 0 10.913 5.572 5.183 5.183 0 0 1 3.434-6.48 5.179 5.179 0 0 1 5.546 1.682 9.088 9.088 0 0 0 3.33-1.317 5.043 5.043 0 0 1-2.4 2.942 9.095 9.095 0 0 0 3.02-.85 5.058 5.058 0 0 1-2.48 2.71z\' fill=\'%232aa9e0\'/%3E%3C/svg%3E");background-position:50%;background-size:50%;background-repeat:no-repeat;width:100%;height:100%;margin-top:-1px}.mz-bug-facebook-link{width:48px;height:48px;border-left:1px solid rgba(0,0,0,.1)}.mz-bug-facebook-link:active,.mz-bug-facebook-link:hover{background:#fff;box-shadow:inset 0 -4px 0 #3b579d}.mz-bug-facebook-logo{background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'28\' height=\'28\' viewBox=\'0 0 28 28\'%3E%3Cpath d=\'M27.825 4.783c0-2.427-2.182-4.608-4.608-4.608H4.783C2.36.175.175 2.357.175 4.783v18.434c0 2.427 2.18 4.608 4.608 4.608H14V17.38h-3.38v-4.61H14v-1.794c0-3.09 2.335-5.885 5.192-5.885h3.718V9.7h-3.726c-.408 0-.884.49-.884 1.235v1.836h4.61v4.61H18.3v10.445h4.916c2.422 0 4.608-2.188 4.608-4.608V4.783z\' fill=\'%233b579d\'/%3E%3C/svg%3E");background-position:50%;background-size:40%;background-repeat:no-repeat;width:100%;height:100%;margin-top:-1px}.mz-bug-github-link{width:48px;height:48px;border-left:1px solid rgba(0,0,0,.1)}.mz-bug-github-link:active,.mz-bug-github-link:hover{background:#fff;box-shadow:inset 0 -4px 0 #444}.mz-bug-github-logo{background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' height=\'1024\' width=\'1024\' data-ember-extension=\'1\'%3E%3Cpath d=\'M512 0C229.25 0 0 229.25 0 512c0 226.25 146.688 418.125 350.156 485.812 25.594 4.688 34.938-11.125 34.938-24.625 0-12.188-.47-52.562-.72-95.312C242 908.812 211.907 817.5 211.907 817.5c-23.312-59.125-56.844-74.875-56.844-74.875-46.53-31.75 3.53-31.125 3.53-31.125 51.406 3.562 78.47 52.75 78.47 52.75 45.688 78.25 119.875 55.625 149 42.5 4.654-33 17.904-55.625 32.5-68.375-113.656-12.937-233.218-56.875-233.218-253.063 0-55.938 19.97-101.562 52.656-137.406-5.22-13-22.844-65.094 5.062-135.562 0 0 42.938-13.75 140.812 52.5 40.812-11.406 84.594-17.03 128.125-17.22 43.5.19 87.31 5.876 128.187 17.282 97.688-66.312 140.688-52.5 140.688-52.5 28 70.53 10.375 122.562 5.125 135.5 32.812 35.844 52.625 81.47 52.625 137.406 0 196.688-119.75 240-233.812 252.688 18.438 15.875 34.75 47 34.75 94.75 0 68.438-.688 123.625-.688 140.5 0 13.625 9.312 29.562 35.25 24.562C877.438 930 1024 738.125 1024 512 1024 229.25 794.75 0 512 0z\' fill=\'%23272727\'/%3E%3C/svg%3E");background-position:50%;background-size:45%;background-repeat:no-repeat;width:100%;height:100%;margin-top:-1px;margin-left:-1px}.mz-bug-info{width:48px;height:48px;border-left:1px solid rgba(0,0,0,.1)}.mz-bug-info-logo{background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'48.004\' height=\'48\' viewBox=\'0 0 48.004 48\'%3E%3Ccircle fill=\'%231F1034\' cx=\'24.002\' cy=\'24\' r=\'23\'/%3E%3Cpath fill=\'%23FFF\' d=\'M26.419 16.356c-.657.658-1.464.987-2.417.987-.954 0-1.76-.329-2.418-.987-.659-.659-.987-1.47-.987-2.436 0-.965.328-1.775.987-2.435.658-.658 1.464-.986 2.418-.986.953 0 1.76.328 2.417.986.659.659.988 1.47.988 2.435 0 .967-.329 1.777-.988 2.436zM21.107 37.5V18.501h5.822V37.5h-5.822z\'/%3E%3C/svg%3E");background-position:50%;background-size:45%;background-repeat:no-repeat;width:100%;height:100%;margin-top:-1px;margin-left:-1px}.mz-bug-info:active,.mz-bug-info:hover{background:#fff;box-shadow:inset 0 -4px 0 #2c1e3f;cursor:pointer}.mz-geolocator-icon{display:block;position:absolute;width:100%;height:100%;background-size:70%;background-position:50%;background-repeat:no-repeat;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'15.991\' viewBox=\'0 0 16 15.991\'%3E%3Cpath fill=\'%23454545\' d=\'M5.962 10.098l2.68 5.397 6.857-15-15 7.197 5.462 2.406zm.16-.583L1.934 7.672l11.498-5.52L6.12 9.514z\'/%3E%3C/svg%3E")}.leaflet-control-locate:hover .mz-geolocator-icon:not(.mz-geolocator-active){background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'15.991\' viewBox=\'0 0 16 15.991\'%3E%3Cpath fill=\'%23D4645C\' d=\'M5.962 10.098l2.682 5.397 6.856-15L.5 7.69l5.462 2.41zm.162-.584l-4.19-1.842L13.437 2.15 6.124 9.514z\'/%3E%3C/svg%3E")}.leaflet-pelias-input{box-sizing:border-box;position:absolute;left:0;top:0;height:100%;width:100%;border:none;border-radius:4px;padding-left:26px;text-indent:6px;font-size:14px;background-color:transparent;cursor:pointer}.leaflet-pelias-control{width:26px;height:26px;background-color:#fff;transition:width .1s,height .1s;z-index:810;box-sizing:content-box}.leaflet-oldie .leaflet-pelias-control{border:1px solid #999}.leaflet-touch .leaflet-pelias-control{width:30px;height:30px;line-height:30px}.leaflet-touch .leaflet-pelias-control.leaflet-pelias-expanded{width:280px;height:44px}.leaflet-touch .leaflet-pelias-input{background-size:30px}.leaflet-pelias-expanded{width:280px;height:44px}.leaflet-pelias-expanded .leaflet-pelias-input{padding-right:30px;padding-top:5px;padding-bottom:5px;line-height:32px}span.leaflet-pelias-layer-icon-container{display:inline-block;width:16px;height:16px;margin-right:5px;vertical-align:text-bottom}.leaflet-pelias-results span.leaflet-pelias-layer-icon-container{margin-right:9px}img.leaflet-pelias-layer-icon{width:16px}.leaflet-pelias-layer-icon{vertical-align:top}.leaflet-pelias-layer-icon-point,.leaflet-pelias-layer-icon-polygon{width:100%;height:100%;display:inline-block;background-repeat:no-repeat;background-position:50%;background-size:contain}.leaflet-pelias-layer-icon-point{background-image:url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAA8UlEQVR4AW2RtUEEQRiFcQ/xGvCHWwfbxYVIgleAQx9DhDSAZDg5fkiK+/Ctno4+W/lncpKbilRHL8rJ1lSuGZ3pmX4GKk+3q7TTaTutCHj7jqpSAwbxUTHV02N6hK0l293tVh8aBJWrnHUQZtWdCEx3WRn2Hl3Re0AGZToRWIUusM91WdAcaIF9NREYh26wd+qC3gnaQBlPBFr1p2/PqFCFG4T9qjWlCu8dIduCmdQyG/VOJY6HHdC7GtOPapnaD9oK2gp0CFrOPOpa3XVYDWsEO67abLcxTOBXv6yj2a+rRHt6p++pJGvAK7KOXpGs/QOhzWYklKHtRwAAAABJRU5ErkJggg==")}.leaflet-pelias-layer-icon-polygon{background-image:url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAwUlEQVR4Aa2QtWHFYAyEUxoGCZO+FTyANwguEsZpQn0Y33vK37oLDBDmmALG0nelDiR1NYdhhwWU65iGhWGnNB7tQQkJuY0ZEkpntKfoVu4l4HvUG/X4loB7NJfCAiGfhLIjLg6bhLwTspAJDB0OCPnikYdUekoLzQTXsoLPh0wywYRM84HPCtd1gnEmZDIRyHpeoHTYS/d44jGtOJZLtLIkm+LG3Pldcjb7goOpPTOD9BUfhUpf6ZdDtixjSq9uBBHyqnZfR0FzKgAAAABJRU5ErkJggg==")}@media only screen and (-o-min-device-pixel-ratio:2/1),only screen and (-webkit-min-device-pixel-ratio:2),only screen and (min--moz-device-pixel-ratio:2),only screen and (min-device-pixel-ratio:2){.leaflet-pelias-layer-icon-point{background-image:url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAQAAADZc7J/AAAB7ElEQVR4Ad2UNZgUQRCFG3cnuotwt/57DndNcHdIsQx3txSXCBLcLf8gwd3dEtwd+qsunF7m0nu1Mztlr6rV5GHYsnRhAvO9TKCLLZurZFeRmdzgS/I1CF+8NtNVTJlOC84nX91XfhHnaThPizTp7XmSSJKQvOWtT1adJ3T438ircMtJRT6xmcFYrH9v4ZNa79qqmetvTELgfbr9Zu/GAxe62JApvR5vJf0Frf/yteGlzMtb6sUJpmv9+apnM9JLtmrztYdpcYLdMl2vbA3t54rzdFyhrsxPTV4Jwa44wUlJuEgx0dbnyOz79zrRi3FR/CfjBOcl4LT1BC4f+38s336Xz3dQjDPiPx8nOCIB92w50aYkXpNdMFmGUI574j8cJ1gbatJTEoqxnMdeltswpF7az9o4QV+d54MN86ulLHqMGuTnkK5R3/g+LM1VPQN/BdGPkH7FljZxMFa37DFb/Dd7SU6pZ6zJBEr8CBz9m32cWk9RwmQGvbXV22T9sGVxW4fWK82B3puEqVzyw7JULXtNGtBUj9Qz6ovekFd6jJqadGC1Vtws2jbVVpm0oDIPpeYnBjKIT9LPQyqb9GCS7smPXkL9qbm91P3BIogcIL3Y04MhydccXzm8GWxyC1eIccxmppfZjHOFTN7FN9tNMvTh24i9AAAAAElFTkSuQmCC")}.leaflet-pelias-layer-icon-polygon{background-image:url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAQAAADZc7J/AAAB0UlEQVR4Ae2UtYLVYBSEc4M7FSXbrku+ZPGXwe0BcOtxd3d3d22BBTocynW3MNc1gnV7JnI8md+MAfmPQglz2Mx+YQuLrNLfK57KBdps10nAdmmTZ0qo4mqT1XQ4LjHYAjHI086K6khQeYTdTqpI7xOcSFkCu6pN/59fHUtr4AN689IebY/mlTRXnoYoKVb7c+9Qch+reKN3C07M69Aq6w1L6dW7A++x4EKMez8/6ZN2POU/IquPT4q40i54lFulGvnMgfvJfS5wjjt8RbYIxGNtlBT+/qJoAlvYTk8sPQPyu3Szj01IZ3bhBltqXTqpYij1SvrCE90Nwnde8kOeemsYpXQoa3PhBvsVamAcRbSI6V6RGslYYVQ0Jk8LRdZ4GpS1L0yDPckG1kjF9snTwkR7Ak2OZ4PNcQo1cQqfeKK7gUa+SvsapSBy1XQpa0PhBnNiY7yVLXR7DOJudsRyZnnsv5xp/MptbnBTd6hplHAxtZD6pR02jGnmVFP+Y5kLibPeK3EGnRlLudVjKU82vIV1TuZmepW7maStMvyk1uSA7bmd9fsHKoJOhIqICLRnHiip4g5WO2a4I20Sl8MfaR5ilbOYbewTNrPQKjEG5P/JL9yhc+zlltlOAAAAAElFTkSuQmCC")}}.leaflet-pelias-close{display:none;position:absolute;right:0;width:26px;height:100%;padding-right:2px;text-align:center;vertical-align:middle;font:normal 18px/26px Lucida Console,Monaco,monospace;background-color:transparent;cursor:pointer;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}.leaflet-pelias-expanded .leaflet-pelias-close{display:table-cell;background-color:inherit;border-top-right-radius:4px;border-bottom-right-radius:4px}.leaflet-pelias-expanded .leaflet-pelias-close.leaflet-pelias-hidden{display:none}.leaflet-pelias-close:before{content:"";display:inline-block;height:100%;vertical-align:middle}.leaflet-touch .leaflet-pelias-input.leaflet-bar{border-radius:4px;border:0 none}.leaflet-touch .leaflet-pelias-results.leaflet-bar{border-radius:2px;border:0 none}.leaflet-pelias-search-icon{position:absolute;height:100%;background-image:url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA00lEQVQ4y2NgoAUwNjYOBOJOIJ4ExIVALEWsRkMgfg3E/7HgWkKaTZEUXwPiIiBOBuKVSOKTcWlmBOKbUEXTsMjbIRnigs2AYKjkBTwuLIaqWY9NcjpUsgqPAWJQNW+xSc6DSmbhMYAPquYrNskMqORGPAb4Q9UcwyapiBRIXjgMuAGVT8BlQwWSIZVALALE3NAYuIkkJ4svLTThSER/gfgTlH0fiAXxGaIJxEuB+CUowID4OBB7Q+WOQw15TnTyxmLBOaghveQaIAlK0kAsTJWcCwAWwX66ECx5RAAAAABJRU5ErkJggg==");background-repeat:no-repeat;background-position:50%;background-size:16px;z-index:10;cursor:pointer}.leaflet-bar a.leaflet-pelias-search-icon{border-radius:4px;border-bottom:0;height:100%}.leaflet-bar a.leaflet-pelias-search-icon:not(:hover){background-color:transparent}.leaflet-pelias-expanded a.leaflet-pelias-search-icon{border-top-right-radius:0;border-bottom-right-radius:0}.leaflet-pelias-search-icon.leaflet-pelias-loading{background-image:url("data:image/gif;base64,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")}@media only screen and (-o-min-device-pixel-ratio:2/1),only screen and (-webkit-min-device-pixel-ratio:2),only screen and (min--moz-device-pixel-ratio:2),only screen and (min-device-pixel-ratio:2){.leaflet-pelias-search-icon{background-image:url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAB00lEQVR42u3XMUhbQRjA8ZMQEMQghiCokxiKVER5FB06JDq4uIoiHVzEJVsHHRwcnER0UnEQBBFECAayOBSK4FR0bAaVLjUOcXCRVpRw/gUHOb7H3bsE7dDAb7yPf4737nhKa/2u/p2AIAhcpZB5kYbyEDlgCOsooQr9yjX2MY54vQOef9+hHf3GVD0CmrGJR2gPx+jxDUjgDDrEJYrI4xQP0II7BD4Bh8KwB6yhSxjWghyuhXVXSEUJmBKGlDEAZZHEkbB+1zUghktjcSXiqxbHN2NGFb0uAV+Ebf8MFVESv4xZey4BRWmRB+nP/EHcFlA2Fo3XEJAQXuE+W4A2pKF8Cc/TWNSAVI0BP80dtQX8NRZ8qjGgYswbsQWcGgsWoDwFwo622QJWhSM35hmwYcwqubyGg0L1V6iI+oX7YdH1KP4hHEZZKEftuBAupZRrwEfcGgPusYIOqBCNmAm5kHJRb8PRkCv2EXnMYhgZTGIDN9AhztDqHgBMGxHe5Ag5wJQVt9TuHhVLhBggacEy7qAtqjjAB6RRDouwBIiaMIp5bCGPAnawhAnzoEEnToSIc3TLAfUXR0GIKEkBbxkxJwW8VcQ2GvwD/DViG7HXD+H/r+MnDkm76ESiLMQAAAAASUVORK5CYII=")}.leaflet-pelias-search-icon.leaflet-pelias-loading{background-image:url("data:image/gif;base64,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")}}.leaflet-pelias-input:focus{outline:none;cursor:text}.leaflet-pelias-input::-ms-clear{display:none}.leaflet-pelias-results{width:100%;position:absolute;left:0;overflow-y:auto;overflow-x:hidden;display:none}.leaflet-touch .leaflet-pelias-results{box-shadow:0 0 0 2px rgba(0,0,0,.2)}.leaflet-oldie .leaflet-pelias-results{border:1px solid #999;left:-1px}.leaflet-top .leaflet-pelias-results{top:50px}.leaflet-bottom .leaflet-pelias-results{bottom:50px}.leaflet-pelias-list{list-style:none;margin:0;padding:0}.leaflet-pelias-results .leaflet-pelias-result{font-size:13px;padding:7px;background-color:#fff;border-top:1px solid #f1f1f1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}.leaflet-pelias-results .leaflet-pelias-result:first-child{border:none}.leaflet-pelias-results .leaflet-pelias-result:hover{background-color:#d5f1f3;border-color:#d5f1f3}.leaflet-pelias-results .leaflet-pelias-result.leaflet-pelias-selected,.leaflet-pelias-results .leaflet-pelias-result.leaflet-pelias-selected:hover{background-color:#b2e3e7;border-color:#b2e3e7}.leaflet-pelias-message{font-size:13px;padding:7px;background-color:#fff;overflow-x:auto}.leaflet-right .leaflet-pelias-input,.leaflet-right .leaflet-pelias-results{left:auto;right:0}.leaflet-bar a.leaflet-pelias-search-icon{border-bottom:0!important;height:100%!important}.leaflet-pelias-control.leaflet-pelias-control.leaflet-pelias-control{z-index:810}.leaflet-touch .leaflet-pelias-results.leaflet-bar{border-radius:4px;border:2px solid rgba(0,0,0,.2);margin-left:-2px}.leaflet-touch .leaflet-pelias-control.leaflet-pelias-expanded{line-height:32px}'

// Loads stylesheet for the bug.
// Ensures that it is placed before other defined stylesheets or style
// blocks in the head, so that custom styles are allowed to override
function insertStylesheet (cssText) {
  var firstStylesheet = document.head.querySelectorAll('link, style')[0]
  var styleEl = document.createElement('style')

  styleEl.type = 'text/css'

  if (styleEl.styleSheet){
    styleEl.styleSheet.cssText = css
  } else {
    styleEl.appendChild(document.createTextNode(css))
  }

  if (firstStylesheet !== 'undefined') {
    document.head.insertBefore(styleEl, firstStylesheet)
  } else {
    document.head.appendChild(styleEl)
  }
}

insertStylesheet(css)

// Export
module.exports = (function () {
  var MPZN = {
    // Reference for legacy
    citysearch: search,
    geolocator: geolocator,
    Utils: {
      anchorTargets: anchorTargets,
      zoomControl: zoomControl,
    }
  }

  MPZN.bug = function (options) {
    options = options || {}
    var bug = Bug(options)

    var leafletMap

    // What is the leaflet Map object? You can pass it in as an option, or look for it
    // on window.map and see if it a Leaflet instance
    if (options.map) {
      leafletMap = options.map
    } else if (window.map && window.map._container && window.map._container instanceof HTMLElement) {
      leafletMap = window.map
    }

    // if leaflet, move the bug element into its .leaflet-control-container
    if (leafletMap && bug.el && bug.el instanceof HTMLElement) {
      leafletMap._container.querySelector('.leaflet-control-container').appendChild(bug.el)
    }

    // Sorted by reverse order
    geolocator.init(options.locate, leafletMap)
    search.init(options.search, leafletMap)
  }

  // Do stuff
  MPZN.Utils.zoomControl()

  // Only operate if iframed
  if (window.self !== window.top) {
    MPZN.Utils.anchorTargets()
  }

  // Expose for external access
  window.MPZN = MPZN

  return MPZN
})()

},{"./components/geolocator/geolocator":4,"./components/search/search":5,"./components/utils/anchor-targets":6,"./components/utils/zoom-control":7,"mapzen-scarab":3}]},{},[8])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvbGVhZmxldC1nZW9jb2Rlci1tYXB6ZW4vZGlzdC9sZWFmbGV0LWdlb2NvZGVyLW1hcHplbi5qcyIsIm5vZGVfbW9kdWxlcy9sZWFmbGV0LmxvY2F0ZWNvbnRyb2wvc3JjL0wuQ29udHJvbC5Mb2NhdGUuanMiLCJub2RlX21vZHVsZXMvbWFwemVuLXNjYXJhYi9zcmMvc2NhcmFiLmpzIiwic3JjL2NvbXBvbmVudHMvZ2VvbG9jYXRvci9nZW9sb2NhdG9yLmpzIiwic3JjL2NvbXBvbmVudHMvc2VhcmNoL3NlYXJjaC5qcyIsInNyYy9jb21wb25lbnRzL3V0aWxzL2FuY2hvci10YXJnZXRzLmpzIiwic3JjL2NvbXBvbmVudHMvdXRpbHMvem9vbS1jb250cm9sLmpzIiwic3JjL21haW4uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ3RuQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDeGtCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM1NBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24oKXtmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc31yZXR1cm4gZX0pKCkiLCIvKlxuICogbGVhZmxldC1nZW9jb2Rlci1tYXB6ZW5cbiAqIExlYWZsZXQgcGx1Z2luIHRvIHNlYXJjaCAoZ2VvY29kZSkgdXNpbmcgTWFwemVuIFNlYXJjaCBvciB5b3VyXG4gKiBvd24gaG9zdGVkIHZlcnNpb24gb2YgdGhlIFBlbGlhcyBHZW9jb2RlciBBUEkuXG4gKlxuICogTGljZW5zZTogTUlUXG4gKiAoYykgTWFwemVuXG4gKi9cbjsoZnVuY3Rpb24gKGZhY3RvcnkpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1leHRyYS1zZW1pXG4gIHZhciBMO1xuICBpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSB7XG4gICAgLy8gQU1EXG4gICAgZGVmaW5lKFsnbGVhZmxldCddLCBmYWN0b3J5KTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJykge1xuICAgIC8vIE5vZGUvQ29tbW9uSlNcbiAgICBMID0gKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3dbJ0wnXSA6IHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWxbJ0wnXSA6IG51bGwpO1xuICAgIG1vZHVsZS5leHBvcnRzID0gZmFjdG9yeShMKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBCcm93c2VyIGdsb2JhbHNcbiAgICBpZiAodHlwZW9mIHdpbmRvdy5MID09PSAndW5kZWZpbmVkJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdMZWFmbGV0IG11c3QgYmUgbG9hZGVkIGZpcnN0Jyk7XG4gICAgfVxuICAgIGZhY3Rvcnkod2luZG93LkwpO1xuICB9XG59KGZ1bmN0aW9uIChMKSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICB2YXIgTUlOSU1VTV9JTlBVVF9MRU5HVEhfRk9SX0FVVE9DT01QTEVURSA9IDE7XG4gIHZhciBGVUxMX1dJRFRIX01BUkdJTiA9IDIwOyAvLyBpbiBwaXhlbHNcbiAgdmFyIEZVTExfV0lEVEhfVE9VQ0hfQURKVVNURURfTUFSR0lOID0gNDsgLy8gaW4gcGl4ZWxzXG4gIHZhciBSRVNVTFRTX0hFSUdIVF9NQVJHSU4gPSAyMDsgLy8gaW4gcGl4ZWxzXG4gIHZhciBBUElfUkFURV9MSU1JVCA9IDI1MDsgLy8gaW4gbXMsIHRocm90dGxlZCB0aW1lIGJldHdlZW4gc3Vic2VxdWVudCByZXF1ZXN0cyB0byBBUElcblxuICBMLkNvbnRyb2wuR2VvY29kZXIgPSBMLkNvbnRyb2wuZXh0ZW5kKHtcblxuICAgIHZlcnNpb246ICcxLjcuMScsXG5cbiAgICBpbmNsdWRlczogTC5NaXhpbi5FdmVudHMsXG5cbiAgICBvcHRpb25zOiB7XG4gICAgICBwb3NpdGlvbjogJ3RvcGxlZnQnLFxuICAgICAgYXR0cmlidXRpb246ICdHZW9jb2RpbmcgYnkgPGEgaHJlZj1cImh0dHBzOi8vbWFwemVuLmNvbS9wcm9qZWN0cy9zZWFyY2gvXCI+TWFwemVuPC9hPicsXG4gICAgICB1cmw6ICdodHRwczovL3NlYXJjaC5tYXB6ZW4uY29tL3YxJyxcbiAgICAgIHBsYWNlaG9sZGVyOiAnU2VhcmNoJyxcbiAgICAgIHRpdGxlOiAnU2VhcmNoJyxcbiAgICAgIGJvdW5kczogZmFsc2UsXG4gICAgICBmb2N1czogdHJ1ZSxcbiAgICAgIGxheWVyczogbnVsbCxcbiAgICAgIHBhblRvUG9pbnQ6IHRydWUsXG4gICAgICBwb2ludEljb246IHRydWUsIC8vICdpbWFnZXMvcG9pbnRfaWNvbi5wbmcnLFxuICAgICAgcG9seWdvbkljb246IHRydWUsIC8vICdpbWFnZXMvcG9seWdvbl9pY29uLnBuZycsXG4gICAgICBmdWxsV2lkdGg6IDY1MCxcbiAgICAgIG1hcmtlcnM6IHRydWUsXG4gICAgICBleHBhbmRlZDogZmFsc2UsXG4gICAgICBhdXRvY29tcGxldGU6IHRydWUsXG4gICAgICBwbGFjZTogZmFsc2VcbiAgICB9LFxuXG4gICAgaW5pdGlhbGl6ZTogZnVuY3Rpb24gKGFwaUtleSwgb3B0aW9ucykge1xuICAgICAgLy8gRm9yIElFOCBjb21wYXRpYmlsaXR5IChpZiBYRG9tYWluUmVxdWVzdCBpcyBwcmVzZW50KSxcbiAgICAgIC8vIHdlIHNldCB0aGUgZGVmYXVsdCB2YWx1ZSBvZiBvcHRpb25zLnVybCB0byB0aGUgcHJvdG9jb2wtcmVsYXRpdmVcbiAgICAgIC8vIHZlcnNpb24sIGJlY2F1c2UgWERvbWFpblJlcXVlc3QgZG9lcyBub3QgYWxsb3cgaHR0cC10by1odHRwcyByZXF1ZXN0c1xuICAgICAgLy8gVGhpcyBpcyBzZXQgZmlyc3Qgc28gaXQgY2FuIGFsd2F5cyBiZSBvdmVycmlkZGVuIGJ5IHRoZSB1c2VyXG4gICAgICBpZiAod2luZG93LlhEb21haW5SZXF1ZXN0KSB7XG4gICAgICAgIHRoaXMub3B0aW9ucy51cmwgPSAnLy9zZWFyY2gubWFwemVuLmNvbS92MSc7XG4gICAgICB9XG5cbiAgICAgIC8vIElmIHRoZSBhcGlLZXkgaXMgb21pdHRlZCBlbnRpcmVseSBhbmQgdGhlXG4gICAgICAvLyBmaXJzdCBwYXJhbWV0ZXIgaXMgYWN0dWFsbHkgdGhlIG9wdGlvbnNcbiAgICAgIGlmICh0eXBlb2YgYXBpS2V5ID09PSAnb2JqZWN0JyAmJiAhIWFwaUtleSkge1xuICAgICAgICBvcHRpb25zID0gYXBpS2V5O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5hcGlLZXkgPSBhcGlLZXk7XG4gICAgICB9XG5cbiAgICAgIC8vIERlcHJlY2F0aW9uIHdhcm5pbmdzXG4gICAgICAvLyBJZiBvcHRpb25zLmxhdGxuZyBpcyBkZWZpbmVkLCB3YXJuLiAoRG8gbm90IGNoZWNrIGZvciBmYWxzeSB2YWx1ZXMsIGJlY2F1c2UgaXQgY2FuIGJlIHNldCB0byBmYWxzZS4pXG4gICAgICBpZiAob3B0aW9ucyAmJiB0eXBlb2Ygb3B0aW9ucy5sYXRsbmcgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIC8vIFNldCB1c2VyLXNwZWNpZmllZCBsYXRsbmcgdG8gZm9jdXMgb3B0aW9uLCBidXQgZG9uJ3Qgb3ZlcndyaXRlIGlmIGl0J3MgYWxyZWFkeSB0aGVyZVxuICAgICAgICBpZiAodHlwZW9mIG9wdGlvbnMuZm9jdXMgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgb3B0aW9ucy5mb2N1cyA9IG9wdGlvbnMubGF0bG5nO1xuICAgICAgICB9XG4gICAgICAgIGNvbnNvbGUubG9nKCdbbGVhZmxldC1nZW9jb2Rlci1tYXB6ZW5dIERFUFJFQ0FUSU9OIFdBUk5JTkc6JyxcbiAgICAgICAgICAnQXMgb2YgdjEuNi4wLCB0aGUgYGxhdGxuZ2Agb3B0aW9uIGlzIGRlcHJlY2F0ZWQuIEl0IGhhcyBiZWVuIHJlbmFtZWQgdG8gYGZvY3VzYC4gYGxhdGxuZ2Agd2lsbCBiZSByZW1vdmVkIGluIGEgZnV0dXJlIHZlcnNpb24uJyk7XG4gICAgICB9XG5cbiAgICAgIC8vIE5vdyBtZXJnZSB1c2VyLXNwZWNpZmllZCBvcHRpb25zXG4gICAgICBMLlV0aWwuc2V0T3B0aW9ucyh0aGlzLCBvcHRpb25zKTtcbiAgICAgIHRoaXMubWFya2VycyA9IFtdO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBSZXNldHMgdGhlIGdlb2NvZGVyIGNvbnRyb2wgdG8gYW4gZW1wdHkgc3RhdGUuXG4gICAgICpcbiAgICAgKiBAcHVibGljXG4gICAgICovXG4gICAgcmVzZXQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgIHRoaXMuX2lucHV0LnZhbHVlID0gJyc7XG4gICAgICBMLkRvbVV0aWwuYWRkQ2xhc3ModGhpcy5fcmVzZXQsICdsZWFmbGV0LXBlbGlhcy1oaWRkZW4nKTtcbiAgICAgIHRoaXMucmVtb3ZlTWFya2VycygpO1xuICAgICAgdGhpcy5jbGVhclJlc3VsdHMoKTtcbiAgICAgIHRoaXMuZmlyZSgncmVzZXQnKTtcbiAgICB9LFxuXG4gICAgZ2V0TGF5ZXJzOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICB2YXIgbGF5ZXJzID0gdGhpcy5vcHRpb25zLmxheWVycztcblxuICAgICAgaWYgKCFsYXllcnMpIHtcbiAgICAgICAgcmV0dXJuIHBhcmFtcztcbiAgICAgIH1cblxuICAgICAgcGFyYW1zLmxheWVycyA9IGxheWVycztcbiAgICAgIHJldHVybiBwYXJhbXM7XG4gICAgfSxcblxuICAgIGdldEJvdW5kaW5nQm94UGFyYW06IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgIC8qXG4gICAgICAgKiB0aGlzLm9wdGlvbnMuYm91bmRzIGNhbiBiZSBvbmUgb2YgdGhlIGZvbGxvd2luZ1xuICAgICAgICogdHJ1ZSAvL0Jvb2xlYW4gLSB0YWtlIHRoZSBtYXAgYm91bmRzXG4gICAgICAgKiBmYWxzZSAvL0Jvb2xlYW4gLSBubyBib3VuZHNcbiAgICAgICAqIEwubGF0TG5nQm91bmRzKC4uLikgLy9PYmplY3RcbiAgICAgICAqIFtbMTAsIDEwXSwgWzQwLCA2MF1dIC8vQXJyYXlcbiAgICAgICovXG4gICAgICB2YXIgYm91bmRzID0gdGhpcy5vcHRpb25zLmJvdW5kcztcblxuICAgICAgLy8gSWYgZmFsc3ksIGJhaWxcbiAgICAgIGlmICghYm91bmRzKSB7XG4gICAgICAgIHJldHVybiBwYXJhbXM7XG4gICAgICB9XG5cbiAgICAgIC8vIElmIHNldCB0byB0cnVlLCB1c2UgbWFwIGJvdW5kc1xuICAgICAgLy8gSWYgaXQgaXMgYSB2YWxpZCBMLkxhdExuZ0JvdW5kcyBvYmplY3QsIGdldCBpdHMgdmFsdWVzXG4gICAgICAvLyBJZiBpdCBpcyBhbiBhcnJheSwgdHJ5IHJ1bm5pbmcgaXQgdGhyb3VnaCBMLkxhdExuZ0JvdW5kc1xuICAgICAgaWYgKGJvdW5kcyA9PT0gdHJ1ZSkge1xuICAgICAgICBib3VuZHMgPSB0aGlzLl9tYXAuZ2V0Qm91bmRzKCk7XG4gICAgICAgIHBhcmFtcyA9IG1ha2VQYXJhbXNGcm9tTGVhZmxldChwYXJhbXMsIGJvdW5kcyk7XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBib3VuZHMgPT09ICdvYmplY3QnICYmIGJvdW5kcy5pc1ZhbGlkICYmIGJvdW5kcy5pc1ZhbGlkKCkpIHtcbiAgICAgICAgcGFyYW1zID0gbWFrZVBhcmFtc0Zyb21MZWFmbGV0KHBhcmFtcywgYm91bmRzKTtcbiAgICAgIH0gZWxzZSBpZiAoTC5VdGlsLmlzQXJyYXkoYm91bmRzKSkge1xuICAgICAgICB2YXIgbGF0TG5nQm91bmRzID0gTC5sYXRMbmdCb3VuZHMoYm91bmRzKTtcbiAgICAgICAgaWYgKGxhdExuZ0JvdW5kcy5pc1ZhbGlkICYmIGxhdExuZ0JvdW5kcy5pc1ZhbGlkKCkpIHtcbiAgICAgICAgICBwYXJhbXMgPSBtYWtlUGFyYW1zRnJvbUxlYWZsZXQocGFyYW1zLCBsYXRMbmdCb3VuZHMpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZ1bmN0aW9uIG1ha2VQYXJhbXNGcm9tTGVhZmxldCAocGFyYW1zLCBsYXRMbmdCb3VuZHMpIHtcbiAgICAgICAgcGFyYW1zWydib3VuZGFyeS5yZWN0Lm1pbl9sb24nXSA9IGxhdExuZ0JvdW5kcy5nZXRXZXN0KCk7XG4gICAgICAgIHBhcmFtc1snYm91bmRhcnkucmVjdC5taW5fbGF0J10gPSBsYXRMbmdCb3VuZHMuZ2V0U291dGgoKTtcbiAgICAgICAgcGFyYW1zWydib3VuZGFyeS5yZWN0Lm1heF9sb24nXSA9IGxhdExuZ0JvdW5kcy5nZXRFYXN0KCk7XG4gICAgICAgIHBhcmFtc1snYm91bmRhcnkucmVjdC5tYXhfbGF0J10gPSBsYXRMbmdCb3VuZHMuZ2V0Tm9ydGgoKTtcbiAgICAgICAgcmV0dXJuIHBhcmFtcztcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHBhcmFtcztcbiAgICB9LFxuXG4gICAgZ2V0Rm9jdXNQYXJhbTogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgLyoqXG4gICAgICAgKiB0aGlzLm9wdGlvbnMuZm9jdXMgY2FuIGJlIG9uZSBvZiB0aGUgZm9sbG93aW5nXG4gICAgICAgKiBbNTAsIDMwXSAgICAgICAgICAgLy8gQXJyYXlcbiAgICAgICAqIHtsb246IDMwLCBsYXQ6IDUwfSAvLyBPYmplY3RcbiAgICAgICAqIHtsYXQ6IDUwLCBsbmc6IDMwfSAvLyBPYmplY3RcbiAgICAgICAqIEwubGF0TG5nKDUwLCAzMCkgICAvLyBPYmplY3RcbiAgICAgICAqIHRydWUgICAgICAgICAgICAgICAvLyBCb29sZWFuIC0gdGFrZSB0aGUgbWFwIGNlbnRlclxuICAgICAgICogZmFsc2UgICAgICAgICAgICAgIC8vIEJvb2xlYW4gLSBObyBsYXRsbmcgdG8gYmUgY29uc2lkZXJlZFxuICAgICAgICovXG4gICAgICB2YXIgZm9jdXMgPSB0aGlzLm9wdGlvbnMuZm9jdXM7XG5cbiAgICAgIGlmICghZm9jdXMpIHtcbiAgICAgICAgcmV0dXJuIHBhcmFtcztcbiAgICAgIH1cblxuICAgICAgaWYgKGZvY3VzID09PSB0cnVlKSB7XG4gICAgICAgIC8vIElmIGZvY3VzIG9wdGlvbiBpcyBCb29sZWFuIHRydWUsIHVzZSBjdXJyZW50IG1hcCBjZW50ZXJcbiAgICAgICAgdmFyIG1hcENlbnRlciA9IHRoaXMuX21hcC5nZXRDZW50ZXIoKTtcbiAgICAgICAgcGFyYW1zWydmb2N1cy5wb2ludC5sYXQnXSA9IG1hcENlbnRlci5sYXQ7XG4gICAgICAgIHBhcmFtc1snZm9jdXMucG9pbnQubG9uJ10gPSBtYXBDZW50ZXIubG5nO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZm9jdXMgPT09ICdvYmplY3QnKSB7XG4gICAgICAgIC8vIEFjY2VwdHMgYXJyYXksIG9iamVjdCBhbmQgTC5sYXRMbmcgZm9ybVxuICAgICAgICAvLyBDb25zdHJ1Y3RzIHRoZSBsYXRsbmcgb2JqZWN0IHVzaW5nIExlYWZsZXQncyBMLmxhdExuZygpXG4gICAgICAgIC8vIFs1MCwgMzBdXG4gICAgICAgIC8vIHtsb246IDMwLCBsYXQ6IDUwfVxuICAgICAgICAvLyB7bGF0OiA1MCwgbG5nOiAzMH1cbiAgICAgICAgLy8gTC5sYXRMbmcoNTAsIDMwKVxuICAgICAgICB2YXIgbGF0bG5nID0gTC5sYXRMbmcoZm9jdXMpO1xuICAgICAgICBwYXJhbXNbJ2ZvY3VzLnBvaW50LmxhdCddID0gbGF0bG5nLmxhdDtcbiAgICAgICAgcGFyYW1zWydmb2N1cy5wb2ludC5sb24nXSA9IGxhdGxuZy5sbmc7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBwYXJhbXM7XG4gICAgfSxcblxuICAgIC8vIEBtZXRob2QgZ2V0UGFyYW1zKHBhcmFtczogT2JqZWN0KVxuICAgIC8vIENvbGxlY3RzIGFsbCB0aGUgcGFyYW1ldGVycyBpbiBhIHNpbmdsZSBvYmplY3QgZnJvbSB2YXJpb3VzIG9wdGlvbnMsXG4gICAgLy8gaW5jbHVkaW5nIG9wdGlvbnMuYm91bmRzLCBvcHRpb25zLmZvY3VzLCBvcHRpb25zLmxheWVycywgdGhlIGFwaSBrZXksXG4gICAgLy8gYW5kIGFueSBwYXJhbXMgdGhhdCBhcmUgcHJvdmlkZWQgYXMgYSBhcmd1bWVudCB0byB0aGlzIGZ1bmN0aW9uLlxuICAgIC8vIE5vdGUgdGhhdCBvcHRpb25zLnBhcmFtcyB3aWxsIG92ZXJ3cml0ZSBhbnkgb2YgdGhlc2VcbiAgICBnZXRQYXJhbXM6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgIHBhcmFtcyA9IHBhcmFtcyB8fCB7fTtcbiAgICAgIHBhcmFtcyA9IHRoaXMuZ2V0Qm91bmRpbmdCb3hQYXJhbShwYXJhbXMpO1xuICAgICAgcGFyYW1zID0gdGhpcy5nZXRGb2N1c1BhcmFtKHBhcmFtcyk7XG4gICAgICBwYXJhbXMgPSB0aGlzLmdldExheWVycyhwYXJhbXMpO1xuXG4gICAgICAvLyBTZWFyY2ggQVBJIGtleVxuICAgICAgaWYgKHRoaXMuYXBpS2V5KSB7XG4gICAgICAgIHBhcmFtcy5hcGlfa2V5ID0gdGhpcy5hcGlLZXk7XG4gICAgICB9XG5cbiAgICAgIHZhciBuZXdQYXJhbXMgPSB0aGlzLm9wdGlvbnMucGFyYW1zO1xuXG4gICAgICBpZiAoIW5ld1BhcmFtcykge1xuICAgICAgICByZXR1cm4gcGFyYW1zO1xuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIG5ld1BhcmFtcyA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgZm9yICh2YXIgcHJvcCBpbiBuZXdQYXJhbXMpIHtcbiAgICAgICAgICBwYXJhbXNbcHJvcF0gPSBuZXdQYXJhbXNbcHJvcF07XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHBhcmFtcztcbiAgICB9LFxuXG4gICAgc2VhcmNoOiBmdW5jdGlvbiAoaW5wdXQpIHtcbiAgICAgIC8vIFByZXZlbnQgbGFjayBvZiBpbnB1dCBmcm9tIHNlbmRpbmcgYSBtYWxmb3JtZWQgcXVlcnkgdG8gUGVsaWFzXG4gICAgICBpZiAoIWlucHV0KSByZXR1cm47XG5cbiAgICAgIHZhciB1cmwgPSB0aGlzLm9wdGlvbnMudXJsICsgJy9zZWFyY2gnO1xuICAgICAgdmFyIHBhcmFtcyA9IHtcbiAgICAgICAgdGV4dDogaW5wdXRcbiAgICAgIH07XG5cbiAgICAgIHRoaXMuY2FsbFBlbGlhcyh1cmwsIHBhcmFtcywgJ3NlYXJjaCcpO1xuICAgIH0sXG5cbiAgICBhdXRvY29tcGxldGU6IHRocm90dGxlKGZ1bmN0aW9uIChpbnB1dCkge1xuICAgICAgLy8gUHJldmVudCBsYWNrIG9mIGlucHV0IGZyb20gc2VuZGluZyBhIG1hbGZvcm1lZCBxdWVyeSB0byBQZWxpYXNcbiAgICAgIGlmICghaW5wdXQpIHJldHVybjtcblxuICAgICAgdmFyIHVybCA9IHRoaXMub3B0aW9ucy51cmwgKyAnL2F1dG9jb21wbGV0ZSc7XG4gICAgICB2YXIgcGFyYW1zID0ge1xuICAgICAgICB0ZXh0OiBpbnB1dFxuICAgICAgfTtcblxuICAgICAgdGhpcy5jYWxsUGVsaWFzKHVybCwgcGFyYW1zLCAnYXV0b2NvbXBsZXRlJyk7XG4gICAgfSwgQVBJX1JBVEVfTElNSVQpLFxuXG4gICAgcGxhY2U6IGZ1bmN0aW9uIChpZCkge1xuICAgICAgLy8gUHJldmVudCBsYWNrIG9mIGlucHV0IGZyb20gc2VuZGluZyBhIG1hbGZvcm1lZCBxdWVyeSB0byBQZWxpYXNcbiAgICAgIGlmICghaWQpIHJldHVybjtcblxuICAgICAgdmFyIHVybCA9IHRoaXMub3B0aW9ucy51cmwgKyAnL3BsYWNlJztcbiAgICAgIHZhciBwYXJhbXMgPSB7XG4gICAgICAgIGlkczogaWRcbiAgICAgIH07XG5cbiAgICAgIHRoaXMuY2FsbFBlbGlhcyh1cmwsIHBhcmFtcywgJ3BsYWNlJyk7XG4gICAgfSxcblxuICAgIGhhbmRsZVBsYWNlUmVzcG9uc2U6IGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgLy8gUGxhY2Vob2xkZXIgZm9yIGhhbmRsaW5nIHBsYWNlIHJlc3BvbnNlXG4gICAgfSxcblxuICAgIC8vIFRpbWVzdGFtcCBvZiB0aGUgbGFzdCByZXNwb25zZSB3aGljaCB3YXMgc3VjY2Vzc2Z1bGx5IHJlbmRlcmVkIHRvIHRoZSBVSS5cbiAgICAvLyBUaGUgdGltZSByZXByZXNlbnRzIHdoZW4gdGhlIHJlcXVlc3Qgd2FzICpzZW50Kiwgbm90IHdoZW4gaXQgd2FzIHJlY2lldmVkLlxuICAgIG1heFJlcVRpbWVzdGFtcFJlbmRlcmVkOiBuZXcgRGF0ZSgpLmdldFRpbWUoKSxcblxuICAgIGNhbGxQZWxpYXM6IGZ1bmN0aW9uIChlbmRwb2ludCwgcGFyYW1zLCB0eXBlKSB7XG4gICAgICBwYXJhbXMgPSB0aGlzLmdldFBhcmFtcyhwYXJhbXMpO1xuXG4gICAgICBMLkRvbVV0aWwuYWRkQ2xhc3ModGhpcy5fc2VhcmNoLCAnbGVhZmxldC1wZWxpYXMtbG9hZGluZycpO1xuXG4gICAgICAvLyBUcmFjayB3aGVuIHRoZSByZXF1ZXN0IGJlZ2FuXG4gICAgICB2YXIgcmVxU3RhcnRlZEF0ID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG5cbiAgICAgIEFKQVgucmVxdWVzdChlbmRwb2ludCwgcGFyYW1zLCBmdW5jdGlvbiAoZXJyLCByZXN1bHRzKSB7XG4gICAgICAgIEwuRG9tVXRpbC5yZW1vdmVDbGFzcyh0aGlzLl9zZWFyY2gsICdsZWFmbGV0LXBlbGlhcy1sb2FkaW5nJyk7XG5cbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIHZhciBlcnJvck1lc3NhZ2U7XG4gICAgICAgICAgc3dpdGNoIChlcnIuY29kZSkge1xuICAgICAgICAgICAgLy8gRXJyb3IgY29kZXMuXG4gICAgICAgICAgICAvLyBodHRwczovL21hcHplbi5jb20vZG9jdW1lbnRhdGlvbi9zZWFyY2gvaHR0cC1zdGF0dXMtY29kZXMvXG4gICAgICAgICAgICBjYXNlIDQwMzpcbiAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlID0gJ0EgdmFsaWQgQVBJIGtleSBpcyBuZWVkZWQgZm9yIHRoaXMgc2VhcmNoIGZlYXR1cmUuJztcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlIDQwNDpcbiAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlID0gJ1RoZSBzZWFyY2ggc2VydmljZSBjYW5ub3QgYmUgZm91bmQuIDotKCc7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSA0MDg6XG4gICAgICAgICAgICAgIGVycm9yTWVzc2FnZSA9ICdUaGUgc2VhcmNoIHNlcnZpY2UgdG9vayB0b28gbG9uZyB0byByZXNwb25kLiBUcnkgYWdhaW4gaW4gYSBzZWNvbmQuJztcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlIDQyOTpcbiAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlID0gJ1RoZXJlIHdlcmUgdG9vIG1hbnkgcmVxdWVzdHMuIFRyeSBhZ2FpbiBpbiBhIHNlY29uZC4nO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgNTAwOlxuICAgICAgICAgICAgICBlcnJvck1lc3NhZ2UgPSAnVGhlIHNlYXJjaCBzZXJ2aWNlIGlzIG5vdCB3b3JraW5nIHJpZ2h0IG5vdy4gUGxlYXNlIHRyeSBhZ2FpbiBsYXRlci4nO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgNTAyOlxuICAgICAgICAgICAgICBlcnJvck1lc3NhZ2UgPSAnQ29ubmVjdGlvbiBsb3N0LiBQbGVhc2UgdHJ5IGFnYWluIGxhdGVyLic7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgLy8gTm90ZSB0aGUgc3RhdHVzIGNvZGUgaXMgMCBpZiBDT1JTIGlzIG5vdCBlbmFibGVkIG9uIHRoZSBlcnJvciByZXNwb25zZVxuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlID0gJ1RoZSBzZWFyY2ggc2VydmljZSBpcyBoYXZpbmcgcHJvYmxlbXMgOi0oJztcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuc2hvd01lc3NhZ2UoZXJyb3JNZXNzYWdlKTtcbiAgICAgICAgICB0aGlzLmZpcmUoJ2Vycm9yJywge1xuICAgICAgICAgICAgcmVzdWx0czogcmVzdWx0cyxcbiAgICAgICAgICAgIGVuZHBvaW50OiBlbmRwb2ludCxcbiAgICAgICAgICAgIHJlcXVlc3RUeXBlOiB0eXBlLFxuICAgICAgICAgICAgcGFyYW1zOiBwYXJhbXMsXG4gICAgICAgICAgICBlcnJvckNvZGU6IGVyci5jb2RlLFxuICAgICAgICAgICAgZXJyb3JNZXNzYWdlOiBlcnJvck1lc3NhZ2VcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRoZXJlIG1pZ2h0IGJlIGFuIGVycm9yIG1lc3NhZ2UgZnJvbSB0aGUgZ2VvY29kaW5nIHNlcnZpY2UgaXRzZWxmXG4gICAgICAgIGlmIChyZXN1bHRzICYmIHJlc3VsdHMuZ2VvY29kaW5nICYmIHJlc3VsdHMuZ2VvY29kaW5nLmVycm9ycykge1xuICAgICAgICAgIGVycm9yTWVzc2FnZSA9IHJlc3VsdHMuZ2VvY29kaW5nLmVycm9yc1swXTtcbiAgICAgICAgICB0aGlzLnNob3dNZXNzYWdlKGVycm9yTWVzc2FnZSk7XG4gICAgICAgICAgdGhpcy5maXJlKCdlcnJvcicsIHtcbiAgICAgICAgICAgIHJlc3VsdHM6IHJlc3VsdHMsXG4gICAgICAgICAgICBlbmRwb2ludDogZW5kcG9pbnQsXG4gICAgICAgICAgICByZXF1ZXN0VHlwZTogdHlwZSxcbiAgICAgICAgICAgIHBhcmFtczogcGFyYW1zLFxuICAgICAgICAgICAgZXJyb3JDb2RlOiBlcnIuY29kZSxcbiAgICAgICAgICAgIGVycm9yTWVzc2FnZTogZXJyb3JNZXNzYWdlXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXV0b2NvbXBsZXRlIGFuZCBzZWFyY2ggcmVzcG9uc2VzXG4gICAgICAgIGlmIChyZXN1bHRzICYmIHJlc3VsdHMuZmVhdHVyZXMpIHtcbiAgICAgICAgICAvLyBDaGVjayBpZiByZXF1ZXN0IGlzIHN0YWxlOlxuICAgICAgICAgIC8vIE9ubHkgZm9yIGF1dG9jb21wbGV0ZSBvciBzZWFyY2ggZW5kcG9pbnRzXG4gICAgICAgICAgLy8gSWdub3JlIHJlcXVlc3RzIGlmIGlucHV0IGlzIGN1cnJlbnRseSBibGFua1xuICAgICAgICAgIC8vIElnbm9yZSByZXF1ZXN0cyB0aGF0IHN0YXJ0ZWQgYmVmb3JlIGEgcmVxdWVzdCB3aGljaCBoYXMgYWxyZWFkeVxuICAgICAgICAgIC8vIGJlZW4gc3VjY2Vzc2Z1bGx5IHJlbmRlcmVkIG9uIHRvIHRoZSBVSS5cbiAgICAgICAgICBpZiAodHlwZSA9PT0gJ2F1dG9jb21wbGV0ZScgfHwgdHlwZSA9PT0gJ3NlYXJjaCcpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLl9pbnB1dC52YWx1ZSA9PT0gJycgfHwgdGhpcy5tYXhSZXFUaW1lc3RhbXBSZW5kZXJlZCA+PSByZXFTdGFydGVkQXQpIHtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgLy8gUmVjb3JkIHRoZSB0aW1lc3RhbXAgb2YgdGhlIHJlcXVlc3QuXG4gICAgICAgICAgICAgIHRoaXMubWF4UmVxVGltZXN0YW1wUmVuZGVyZWQgPSByZXFTdGFydGVkQXQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gUGxhY2Vob2xkZXI6IGhhbmRsZSBwbGFjZSByZXNwb25zZVxuICAgICAgICAgIGlmICh0eXBlID09PSAncGxhY2UnKSB7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZVBsYWNlUmVzcG9uc2UocmVzdWx0cyk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gU2hvdyByZXN1bHRzXG4gICAgICAgICAgaWYgKHR5cGUgPT09ICdhdXRvY29tcGxldGUnIHx8IHR5cGUgPT09ICdzZWFyY2gnKSB7XG4gICAgICAgICAgICB0aGlzLnNob3dSZXN1bHRzKHJlc3VsdHMuZmVhdHVyZXMsIHBhcmFtcy50ZXh0KTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBGaXJlIGV2ZW50XG4gICAgICAgICAgdGhpcy5maXJlKCdyZXN1bHRzJywge1xuICAgICAgICAgICAgcmVzdWx0czogcmVzdWx0cyxcbiAgICAgICAgICAgIGVuZHBvaW50OiBlbmRwb2ludCxcbiAgICAgICAgICAgIHJlcXVlc3RUeXBlOiB0eXBlLFxuICAgICAgICAgICAgcGFyYW1zOiBwYXJhbXNcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSwgdGhpcyk7XG4gICAgfSxcblxuICAgIGhpZ2hsaWdodDogZnVuY3Rpb24gKHRleHQsIGZvY3VzKSB7XG4gICAgICB2YXIgciA9IFJlZ0V4cCgnKCcgKyBlc2NhcGVSZWdFeHAoZm9jdXMpICsgJyknLCAnZ2knKTtcbiAgICAgIHJldHVybiB0ZXh0LnJlcGxhY2UociwgJzxzdHJvbmc+JDE8L3N0cm9uZz4nKTtcbiAgICB9LFxuXG4gICAgZ2V0SWNvblR5cGU6IGZ1bmN0aW9uIChsYXllcikge1xuICAgICAgdmFyIHBvaW50SWNvbiA9IHRoaXMub3B0aW9ucy5wb2ludEljb247XG4gICAgICB2YXIgcG9seWdvbkljb24gPSB0aGlzLm9wdGlvbnMucG9seWdvbkljb247XG4gICAgICB2YXIgY2xhc3NQcmVmaXggPSAnbGVhZmxldC1wZWxpYXMtbGF5ZXItaWNvbi0nO1xuXG4gICAgICBpZiAobGF5ZXIubWF0Y2goJ3ZlbnVlJykgfHwgbGF5ZXIubWF0Y2goJ2FkZHJlc3MnKSkge1xuICAgICAgICBpZiAocG9pbnRJY29uID09PSB0cnVlKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6ICdjbGFzcycsXG4gICAgICAgICAgICB2YWx1ZTogY2xhc3NQcmVmaXggKyAncG9pbnQnXG4gICAgICAgICAgfTtcbiAgICAgICAgfSBlbHNlIGlmIChwb2ludEljb24gPT09IGZhbHNlKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiAnaW1hZ2UnLFxuICAgICAgICAgICAgdmFsdWU6IHBvaW50SWNvblxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChwb2x5Z29uSWNvbiA9PT0gdHJ1ZSkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiAnY2xhc3MnLFxuICAgICAgICAgICAgdmFsdWU6IGNsYXNzUHJlZml4ICsgJ3BvbHlnb24nXG4gICAgICAgICAgfTtcbiAgICAgICAgfSBlbHNlIGlmIChwb2x5Z29uSWNvbiA9PT0gZmFsc2UpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6ICdpbWFnZScsXG4gICAgICAgICAgICB2YWx1ZTogcG9seWdvbkljb25cbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcblxuICAgIHNob3dSZXN1bHRzOiBmdW5jdGlvbiAoZmVhdHVyZXMsIGlucHV0KSB7XG4gICAgICAvLyBFeGl0IGZ1bmN0aW9uIGlmIHRoZXJlIGFyZSBubyBmZWF0dXJlc1xuICAgICAgaWYgKGZlYXR1cmVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB0aGlzLnNob3dNZXNzYWdlKCdObyByZXN1bHRzIHdlcmUgZm91bmQuJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgdmFyIHJlc3VsdHNDb250YWluZXIgPSB0aGlzLl9yZXN1bHRzO1xuXG4gICAgICAvLyBSZXNldCBhbmQgZGlzcGxheSByZXN1bHRzIGNvbnRhaW5lclxuICAgICAgcmVzdWx0c0NvbnRhaW5lci5pbm5lckhUTUwgPSAnJztcbiAgICAgIHJlc3VsdHNDb250YWluZXIuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG4gICAgICAvLyBtYW5hZ2UgcmVzdWx0IGJveCBoZWlnaHRcbiAgICAgIHJlc3VsdHNDb250YWluZXIuc3R5bGUubWF4SGVpZ2h0ID0gKHRoaXMuX21hcC5nZXRTaXplKCkueSAtIHJlc3VsdHNDb250YWluZXIub2Zmc2V0VG9wIC0gdGhpcy5fY29udGFpbmVyLm9mZnNldFRvcCAtIFJFU1VMVFNfSEVJR0hUX01BUkdJTikgKyAncHgnO1xuXG4gICAgICB2YXIgbGlzdCA9IEwuRG9tVXRpbC5jcmVhdGUoJ3VsJywgJ2xlYWZsZXQtcGVsaWFzLWxpc3QnLCByZXN1bHRzQ29udGFpbmVyKTtcblxuICAgICAgZm9yICh2YXIgaSA9IDAsIGogPSBmZWF0dXJlcy5sZW5ndGg7IGkgPCBqOyBpKyspIHtcbiAgICAgICAgdmFyIGZlYXR1cmUgPSBmZWF0dXJlc1tpXTtcbiAgICAgICAgdmFyIHJlc3VsdEl0ZW0gPSBMLkRvbVV0aWwuY3JlYXRlKCdsaScsICdsZWFmbGV0LXBlbGlhcy1yZXN1bHQnLCBsaXN0KTtcblxuICAgICAgICByZXN1bHRJdGVtLmZlYXR1cmUgPSBmZWF0dXJlO1xuICAgICAgICByZXN1bHRJdGVtLmxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xuXG4gICAgICAgIC8vIERlcHJlY2F0ZWRcbiAgICAgICAgLy8gVXNlIEwuR2VvSlNPTi5jb29yZHNUb0xhdExuZyhyZXN1bHRJdGVtLmZlYXR1cmUuZ2VvbWV0cnkuY29vcmRpbmF0ZXMpIGluc3RlYWRcbiAgICAgICAgLy8gVGhpcyByZXR1cm5zIGEgTC5MYXRMbmcgb2JqZWN0IHRoYXQgY2FuIGJlIHVzZWQgdGhyb3VnaG91dCBMZWFmbGV0XG4gICAgICAgIHJlc3VsdEl0ZW0uY29vcmRzID0gZmVhdHVyZS5nZW9tZXRyeS5jb29yZGluYXRlcztcblxuICAgICAgICB2YXIgaWNvbiA9IHRoaXMuZ2V0SWNvblR5cGUoZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKTtcbiAgICAgICAgaWYgKGljb24pIHtcbiAgICAgICAgICAvLyBQb2ludCBvciBwb2x5Z29uIGljb25cbiAgICAgICAgICAvLyBNYXkgYmUgYSBjbGFzcyBvciBhbiBpbWFnZSBwYXRoXG4gICAgICAgICAgdmFyIGxheWVySWNvbkNvbnRhaW5lciA9IEwuRG9tVXRpbC5jcmVhdGUoJ3NwYW4nLCAnbGVhZmxldC1wZWxpYXMtbGF5ZXItaWNvbi1jb250YWluZXInLCByZXN1bHRJdGVtKTtcbiAgICAgICAgICB2YXIgbGF5ZXJJY29uO1xuXG4gICAgICAgICAgaWYgKGljb24udHlwZSA9PT0gJ2NsYXNzJykge1xuICAgICAgICAgICAgbGF5ZXJJY29uID0gTC5Eb21VdGlsLmNyZWF0ZSgnZGl2JywgJ2xlYWZsZXQtcGVsaWFzLWxheWVyLWljb24gJyArIGljb24udmFsdWUsIGxheWVySWNvbkNvbnRhaW5lcik7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxheWVySWNvbiA9IEwuRG9tVXRpbC5jcmVhdGUoJ2ltZycsICdsZWFmbGV0LXBlbGlhcy1sYXllci1pY29uJywgbGF5ZXJJY29uQ29udGFpbmVyKTtcbiAgICAgICAgICAgIGxheWVySWNvbi5zcmMgPSBpY29uLnZhbHVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGxheWVySWNvbi50aXRsZSA9ICdsYXllcjogJyArIGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJlc3VsdEl0ZW0uaW5uZXJIVE1MICs9IHRoaXMuaGlnaGxpZ2h0KGZlYXR1cmUucHJvcGVydGllcy5sYWJlbCwgaW5wdXQpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBzaG93TWVzc2FnZTogZnVuY3Rpb24gKHRleHQpIHtcbiAgICAgIHZhciByZXN1bHRzQ29udGFpbmVyID0gdGhpcy5fcmVzdWx0cztcblxuICAgICAgLy8gUmVzZXQgYW5kIGRpc3BsYXkgcmVzdWx0cyBjb250YWluZXJcbiAgICAgIHJlc3VsdHNDb250YWluZXIuaW5uZXJIVE1MID0gJyc7XG4gICAgICByZXN1bHRzQ29udGFpbmVyLnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xuXG4gICAgICB2YXIgbWVzc2FnZUVsID0gTC5Eb21VdGlsLmNyZWF0ZSgnZGl2JywgJ2xlYWZsZXQtcGVsaWFzLW1lc3NhZ2UnLCByZXN1bHRzQ29udGFpbmVyKTtcblxuICAgICAgLy8gU2V0IHRleHQuIFRoaXMgaXMgdGhlIG1vc3QgY3Jvc3MtYnJvd3NlciBjb21wYXRpYmxlIG1ldGhvZFxuICAgICAgLy8gYW5kIGF2b2lkcyB0aGUgaXNzdWVzIHdlIGhhdmUgZGV0ZWN0aW5nIGVpdGhlciBpbm5lclRleHQgdnMgdGV4dENvbnRlbnRcbiAgICAgIC8vIChlLmcuIEZpcmVmb3ggY2Fubm90IGRldGVjdCB0ZXh0Q29udGVudCBwcm9wZXJ0eSBvbiBlbGVtZW50cywgYnV0IGl0J3MgdGhlcmUpXG4gICAgICBtZXNzYWdlRWwuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUodGV4dCkpO1xuICAgIH0sXG5cbiAgICByZW1vdmVNYXJrZXJzOiBmdW5jdGlvbiAoKSB7XG4gICAgICBpZiAodGhpcy5vcHRpb25zLm1hcmtlcnMpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLm1hcmtlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICB0aGlzLl9tYXAucmVtb3ZlTGF5ZXIodGhpcy5tYXJrZXJzW2ldKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLm1hcmtlcnMgPSBbXTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgc2hvd01hcmtlcjogZnVuY3Rpb24gKHRleHQsIGxhdGxuZykge1xuICAgICAgdGhpcy5fbWFwLnNldFZpZXcobGF0bG5nLCB0aGlzLl9tYXAuZ2V0Wm9vbSgpIHx8IDgpO1xuXG4gICAgICB2YXIgbWFya2VyT3B0aW9ucyA9ICh0eXBlb2YgdGhpcy5vcHRpb25zLm1hcmtlcnMgPT09ICdvYmplY3QnKSA/IHRoaXMub3B0aW9ucy5tYXJrZXJzIDoge307XG5cbiAgICAgIGlmICh0aGlzLm9wdGlvbnMubWFya2Vycykge1xuICAgICAgICB2YXIgbWFya2VyID0gbmV3IEwubWFya2VyKGxhdGxuZywgbWFya2VyT3B0aW9ucykuYmluZFBvcHVwKHRleHQpOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5ldy1jYXBcbiAgICAgICAgdGhpcy5fbWFwLmFkZExheWVyKG1hcmtlcik7XG4gICAgICAgIHRoaXMubWFya2Vycy5wdXNoKG1hcmtlcik7XG4gICAgICAgIG1hcmtlci5vcGVuUG9wdXAoKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogRml0cyB0aGUgbWFwIHZpZXcgdG8gYSBnaXZlbiBib3VuZGluZyBib3guXG4gICAgICogTWFwemVuIFNlYXJjaCAvIFBlbGlhcyByZXR1cm5zIHRoZSAnYmJveCcgcHJvcGVydHkgb24gJ2ZlYXR1cmUnLiBJdCBpc1xuICAgICAqIGFzIGFuIGFycmF5IG9mIGZvdXIgbnVtYmVyczpcbiAgICAgKiAgIFtcbiAgICAgKiAgICAgMDogc291dGh3ZXN0IGxvbmdpdHVkZSxcbiAgICAgKiAgICAgMTogc291dGh3ZXN0IGxhdGl0dWRlLFxuICAgICAqICAgICAyOiBub3J0aGVhc3QgbG9uZ2l0dWRlLFxuICAgICAqICAgICAzOiBub3J0aGVhc3QgbGF0aXR1ZGVcbiAgICAgKiAgIF1cbiAgICAgKiBUaGlzIG1ldGhvZCBleHBlY3RzIHRoZSBhcnJheSB0byBiZSBwYXNzZWQgZGlyZWN0bHkgYW5kIGl0IHdpbGwgYmUgY29udmVydGVkXG4gICAgICogdG8gYSBib3VuZGFyeSBwYXJhbWV0ZXIgZm9yIExlYWZsZXQncyBmaXRCb3VuZHMoKS5cbiAgICAgKi9cbiAgICBmaXRCb3VuZGluZ0JveDogZnVuY3Rpb24gKGJib3gpIHtcbiAgICAgIHRoaXMuX21hcC5maXRCb3VuZHMoW1xuICAgICAgICBbIGJib3hbMV0sIGJib3hbMF0gXSxcbiAgICAgICAgWyBiYm94WzNdLCBiYm94WzJdIF1cbiAgICAgIF0sIHtcbiAgICAgICAgYW5pbWF0ZTogdHJ1ZSxcbiAgICAgICAgbWF4Wm9vbTogMTZcbiAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBzZXRTZWxlY3RlZFJlc3VsdDogZnVuY3Rpb24gKHNlbGVjdGVkLCBvcmlnaW5hbEV2ZW50KSB7XG4gICAgICB2YXIgbGF0bG5nID0gTC5HZW9KU09OLmNvb3Jkc1RvTGF0TG5nKHNlbGVjdGVkLmZlYXR1cmUuZ2VvbWV0cnkuY29vcmRpbmF0ZXMpO1xuICAgICAgdGhpcy5faW5wdXQudmFsdWUgPSBzZWxlY3RlZC5pbm5lclRleHQgfHwgc2VsZWN0ZWQudGV4dENvbnRlbnQ7XG4gICAgICBpZiAoc2VsZWN0ZWQuZmVhdHVyZS5iYm94KSB7XG4gICAgICAgIHRoaXMucmVtb3ZlTWFya2VycygpO1xuICAgICAgICB0aGlzLmZpdEJvdW5kaW5nQm94KHNlbGVjdGVkLmZlYXR1cmUuYmJveCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnJlbW92ZU1hcmtlcnMoKTtcbiAgICAgICAgdGhpcy5zaG93TWFya2VyKHNlbGVjdGVkLmlubmVySFRNTCwgbGF0bG5nKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuZmlyZSgnc2VsZWN0Jywge1xuICAgICAgICBvcmlnaW5hbEV2ZW50OiBvcmlnaW5hbEV2ZW50LFxuICAgICAgICBsYXRsbmc6IGxhdGxuZyxcbiAgICAgICAgZmVhdHVyZTogc2VsZWN0ZWQuZmVhdHVyZVxuICAgICAgfSk7XG4gICAgICB0aGlzLmJsdXIoKTtcblxuICAgICAgaWYgKHRoaXMub3B0aW9ucy5wbGFjZSkge1xuICAgICAgICB0aGlzLnBsYWNlKHNlbGVjdGVkLmZlYXR1cmUucHJvcGVydGllcy5naWQpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBDb252ZW5pZW5jZSBmdW5jdGlvbiBmb3IgZm9jdXNpbmcgb24gdGhlIGlucHV0XG4gICAgICogQSBgZm9jdXNgIGV2ZW50IGlzIGZpcmVkLCBidXQgaXQgaXMgbm90IGZpcmVkIGhlcmUuIEFuIGV2ZW50IGxpc3RlbmVyXG4gICAgICogd2FzIGFkZGVkIHRvIHRoZSBfaW5wdXQgZWxlbWVudCB0byBmb3J3YXJkIHRoZSBuYXRpdmUgYGZvY3VzYCBldmVudC5cbiAgICAgKlxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBmb2N1czogZnVuY3Rpb24gKCkge1xuICAgICAgLy8gSWYgbm90IGV4cGFuZGVkLCBleHBhbmQgdGhpcyBmaXJzdFxuICAgICAgaWYgKCFMLkRvbVV0aWwuaGFzQ2xhc3ModGhpcy5fY29udGFpbmVyLCAnbGVhZmxldC1wZWxpYXMtZXhwYW5kZWQnKSkge1xuICAgICAgICB0aGlzLmV4cGFuZCgpO1xuICAgICAgfVxuICAgICAgdGhpcy5faW5wdXQuZm9jdXMoKTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogUmVtb3ZlcyBmb2N1cyBmcm9tIGdlb2NvZGVyIGNvbnRyb2xcbiAgICAgKiBBIGBibHVyYCBldmVudCBpcyBmaXJlZCwgYnV0IGl0IGlzIG5vdCBmaXJlZCBoZXJlLiBBbiBldmVudCBsaXN0ZW5lclxuICAgICAqIHdhcyBhZGRlZCBvbiB0aGUgX2lucHV0IGVsZW1lbnQgdG8gZm9yd2FyZCB0aGUgbmF0aXZlIGBibHVyYCBldmVudC5cbiAgICAgKlxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBibHVyOiBmdW5jdGlvbiAoKSB7XG4gICAgICB0aGlzLl9pbnB1dC5ibHVyKCk7XG4gICAgICB0aGlzLmNsZWFyUmVzdWx0cygpO1xuICAgICAgaWYgKHRoaXMuX2lucHV0LnZhbHVlID09PSAnJyAmJiB0aGlzLl9yZXN1bHRzLnN0eWxlLmRpc3BsYXkgIT09ICdub25lJykge1xuICAgICAgICBMLkRvbVV0aWwuYWRkQ2xhc3ModGhpcy5fcmVzZXQsICdsZWFmbGV0LXBlbGlhcy1oaWRkZW4nKTtcbiAgICAgICAgaWYgKCF0aGlzLm9wdGlvbnMuZXhwYW5kZWQpIHtcbiAgICAgICAgICB0aGlzLmNvbGxhcHNlKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuXG4gICAgY2xlYXJSZXN1bHRzOiBmdW5jdGlvbiAoZm9yY2UpIHtcbiAgICAgIC8vIEhpZGUgcmVzdWx0cyBmcm9tIHZpZXdcbiAgICAgIHRoaXMuX3Jlc3VsdHMuc3R5bGUuZGlzcGxheSA9ICdub25lJztcblxuICAgICAgLy8gRGVzdHJveSBjb250ZW50cyBpZiBpbnB1dCBoYXMgYWxzbyBjbGVhcmVkXG4gICAgICAvLyBPUiBpZiBmb3JjZSBpcyB0cnVlXG4gICAgICBpZiAodGhpcy5faW5wdXQudmFsdWUgPT09ICcnIHx8IGZvcmNlID09PSB0cnVlKSB7XG4gICAgICAgIHRoaXMuX3Jlc3VsdHMuaW5uZXJIVE1MID0gJyc7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGV4cGFuZDogZnVuY3Rpb24gKCkge1xuICAgICAgTC5Eb21VdGlsLmFkZENsYXNzKHRoaXMuX2NvbnRhaW5lciwgJ2xlYWZsZXQtcGVsaWFzLWV4cGFuZGVkJyk7XG4gICAgICB0aGlzLnNldEZ1bGxXaWR0aCgpO1xuICAgICAgdGhpcy5maXJlKCdleHBhbmQnKTtcbiAgICB9LFxuXG4gICAgY29sbGFwc2U6IGZ1bmN0aW9uICgpIHtcbiAgICAgIC8vICdleHBhbmRlZCcgb3B0aW9ucyBjaGVjayBoYXBwZW5zIG91dHNpZGUgb2YgdGhpcyBmdW5jdGlvbiBub3dcbiAgICAgIC8vIFNvIGl0J3Mgbm93IHBvc3NpYmxlIGZvciBhIHNjcmlwdCB0byBmb3JjZS1jb2xsYXBzZSBhIGdlb2NvZGVyXG4gICAgICAvLyB0aGF0IG90aGVyd2lzZSBkZWZhdWx0cyB0byB0aGUgYWx3YXlzLWV4cGFuZGVkIHN0YXRlXG4gICAgICBMLkRvbVV0aWwucmVtb3ZlQ2xhc3ModGhpcy5fY29udGFpbmVyLCAnbGVhZmxldC1wZWxpYXMtZXhwYW5kZWQnKTtcbiAgICAgIHRoaXMuX2lucHV0LmJsdXIoKTtcbiAgICAgIHRoaXMuY2xlYXJGdWxsV2lkdGgoKTtcbiAgICAgIHRoaXMuY2xlYXJSZXN1bHRzKCk7XG4gICAgICB0aGlzLmZpcmUoJ2NvbGxhcHNlJyk7XG4gICAgfSxcblxuICAgIC8vIFNldCBmdWxsIHdpZHRoIG9mIGV4cGFuZGVkIGlucHV0LCBpZiBlbmFibGVkXG4gICAgc2V0RnVsbFdpZHRoOiBmdW5jdGlvbiAoKSB7XG4gICAgICBpZiAodGhpcy5vcHRpb25zLmZ1bGxXaWR0aCkge1xuICAgICAgICAvLyBJZiBmdWxsV2lkdGggc2V0dGluZyBpcyBhIG51bWJlciwgb25seSBleHBhbmQgaWYgbWFwIGNvbnRhaW5lclxuICAgICAgICAvLyBpcyBzbWFsbGVyIHRoYW4gdGhhdCBicmVha3BvaW50LiBPdGhlcndpc2UsIGNsZWFyIHdpZHRoXG4gICAgICAgIC8vIEFsd2F5cyBhc2sgbWFwIHRvIGludmFsaWRhdGUgYW5kIHJlY2FsY3VsYXRlIHNpemUgZmlyc3RcbiAgICAgICAgdGhpcy5fbWFwLmludmFsaWRhdGVTaXplKCk7XG4gICAgICAgIHZhciBtYXBXaWR0aCA9IHRoaXMuX21hcC5nZXRTaXplKCkueDtcbiAgICAgICAgdmFyIHRvdWNoQWRqdXN0bWVudCA9IEwuQnJvd3Nlci50b3VjaCA/IEZVTExfV0lEVEhfVE9VQ0hfQURKVVNURURfTUFSR0lOIDogMDtcbiAgICAgICAgdmFyIHdpZHRoID0gbWFwV2lkdGggLSBGVUxMX1dJRFRIX01BUkdJTiAtIHRvdWNoQWRqdXN0bWVudDtcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLm9wdGlvbnMuZnVsbFdpZHRoID09PSAnbnVtYmVyJyAmJiBtYXBXaWR0aCA+PSB3aW5kb3cucGFyc2VJbnQodGhpcy5vcHRpb25zLmZ1bGxXaWR0aCwgMTApKSB7XG4gICAgICAgICAgdGhpcy5jbGVhckZ1bGxXaWR0aCgpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jb250YWluZXIuc3R5bGUud2lkdGggPSB3aWR0aC50b1N0cmluZygpICsgJ3B4JztcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgY2xlYXJGdWxsV2lkdGg6IGZ1bmN0aW9uICgpIHtcbiAgICAgIC8vIENsZWFyIHNldCB3aWR0aCwgaWYgYW55XG4gICAgICBpZiAodGhpcy5vcHRpb25zLmZ1bGxXaWR0aCkge1xuICAgICAgICB0aGlzLl9jb250YWluZXIuc3R5bGUud2lkdGggPSAnJztcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgb25BZGQ6IGZ1bmN0aW9uIChtYXApIHtcbiAgICAgIHZhciBjb250YWluZXIgPSBMLkRvbVV0aWwuY3JlYXRlKCdkaXYnLFxuICAgICAgICAgICdsZWFmbGV0LXBlbGlhcy1jb250cm9sIGxlYWZsZXQtYmFyIGxlYWZsZXQtY29udHJvbCcpO1xuXG4gICAgICB0aGlzLl9ib2R5ID0gZG9jdW1lbnQuYm9keSB8fCBkb2N1bWVudC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnYm9keScpWzBdO1xuICAgICAgdGhpcy5fY29udGFpbmVyID0gY29udGFpbmVyO1xuICAgICAgdGhpcy5faW5wdXQgPSBMLkRvbVV0aWwuY3JlYXRlKCdpbnB1dCcsICdsZWFmbGV0LXBlbGlhcy1pbnB1dCcsIHRoaXMuX2NvbnRhaW5lcik7XG4gICAgICB0aGlzLl9pbnB1dC5zcGVsbGNoZWNrID0gZmFsc2U7XG5cbiAgICAgIC8vIEZvcndhcmRzIGZvY3VzIGFuZCBibHVyIGV2ZW50cyBmcm9tIGlucHV0IHRvIGdlb2NvZGVyXG4gICAgICBMLkRvbUV2ZW50LmFkZExpc3RlbmVyKHRoaXMuX2lucHV0LCAnZm9jdXMnLCBmdW5jdGlvbiAoZSkge1xuICAgICAgICB0aGlzLmZpcmUoJ2ZvY3VzJywgeyBvcmlnaW5hbEV2ZW50OiBlIH0pO1xuICAgICAgfSwgdGhpcyk7XG5cbiAgICAgIEwuRG9tRXZlbnQuYWRkTGlzdGVuZXIodGhpcy5faW5wdXQsICdibHVyJywgZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgdGhpcy5maXJlKCdibHVyJywgeyBvcmlnaW5hbEV2ZW50OiBlIH0pO1xuICAgICAgfSwgdGhpcyk7XG5cbiAgICAgIC8vIE9ubHkgc2V0IGlmIHRpdGxlIG9wdGlvbiBpcyBub3QgbnVsbCBvciBmYWxzeVxuICAgICAgaWYgKHRoaXMub3B0aW9ucy50aXRsZSkge1xuICAgICAgICB0aGlzLl9pbnB1dC50aXRsZSA9IHRoaXMub3B0aW9ucy50aXRsZTtcbiAgICAgIH1cblxuICAgICAgLy8gT25seSBzZXQgaWYgcGxhY2Vob2xkZXIgb3B0aW9uIGlzIG5vdCBudWxsIG9yIGZhbHN5XG4gICAgICBpZiAodGhpcy5vcHRpb25zLnBsYWNlaG9sZGVyKSB7XG4gICAgICAgIHRoaXMuX2lucHV0LnBsYWNlaG9sZGVyID0gdGhpcy5vcHRpb25zLnBsYWNlaG9sZGVyO1xuICAgICAgfVxuXG4gICAgICB0aGlzLl9zZWFyY2ggPSBMLkRvbVV0aWwuY3JlYXRlKCdhJywgJ2xlYWZsZXQtcGVsaWFzLXNlYXJjaC1pY29uJywgdGhpcy5fY29udGFpbmVyKTtcbiAgICAgIHRoaXMuX3Jlc2V0ID0gTC5Eb21VdGlsLmNyZWF0ZSgnZGl2JywgJ2xlYWZsZXQtcGVsaWFzLWNsb3NlIGxlYWZsZXQtcGVsaWFzLWhpZGRlbicsIHRoaXMuX2NvbnRhaW5lcik7XG4gICAgICB0aGlzLl9yZXNldC5pbm5lckhUTUwgPSAnw5cnO1xuICAgICAgdGhpcy5fcmVzZXQudGl0bGUgPSAnUmVzZXQnO1xuXG4gICAgICB0aGlzLl9yZXN1bHRzID0gTC5Eb21VdGlsLmNyZWF0ZSgnZGl2JywgJ2xlYWZsZXQtcGVsaWFzLXJlc3VsdHMgbGVhZmxldC1iYXInLCB0aGlzLl9jb250YWluZXIpO1xuXG4gICAgICBpZiAodGhpcy5vcHRpb25zLmV4cGFuZGVkKSB7XG4gICAgICAgIHRoaXMuZXhwYW5kKCk7XG4gICAgICB9XG5cbiAgICAgIEwuRG9tRXZlbnRcbiAgICAgICAgLm9uKHRoaXMuX2NvbnRhaW5lciwgJ2NsaWNrJywgZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgICAvLyBDaGlsZCBlbGVtZW50cyB3aXRoICdjbGljaycgbGlzdGVuZXJzIHNob3VsZCBjYWxsXG4gICAgICAgICAgLy8gc3RvcFByb3BhZ2F0aW9uKCkgdG8gcHJldmVudCB0aGF0IGV2ZW50IGZyb20gYnViYmxpbmcgdG9cbiAgICAgICAgICAvLyB0aGUgY29udGFpbmVyICYgY2F1c2luZyBpdCB0byBmaXJlIHRvbyBncmVlZGlseVxuICAgICAgICAgIHRoaXMuX2lucHV0LmZvY3VzKCk7XG4gICAgICAgIH0sIHRoaXMpXG4gICAgICAgIC5vbih0aGlzLl9pbnB1dCwgJ2ZvY3VzJywgZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgICBpZiAodGhpcy5faW5wdXQudmFsdWUgJiYgdGhpcy5fcmVzdWx0cy5jaGlsZHJlbi5sZW5ndGgpIHtcbiAgICAgICAgICAgIHRoaXMuX3Jlc3VsdHMuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG4gICAgICAgICAgfVxuICAgICAgICB9LCB0aGlzKVxuICAgICAgICAub24odGhpcy5fbWFwLCAnY2xpY2snLCBmdW5jdGlvbiAoZSkge1xuICAgICAgICAgIC8vIERvZXMgd2hhdCB5b3UgbWlnaHQgZXhwZWN0IGEgX2lucHV0LmJsdXIoKSBsaXN0ZW5lciBtaWdodCBkbyxcbiAgICAgICAgICAvLyBidXQgc2luY2UgdGhhdCB3b3VsZCBmaXJlIGZvciBhbnkgcmVhc29uIChlLmcuIGNsaWNraW5nIGEgcmVzdWx0KVxuICAgICAgICAgIC8vIHdoYXQgeW91IHJlYWxseSB3YW50IGlzIHRvIGJsdXIgZnJvbSB0aGUgY29udHJvbCBieSBsaXN0ZW5pbmcgdG8gY2xpY2tzIG9uIHRoZSBtYXBcbiAgICAgICAgICB0aGlzLmJsdXIoKTtcbiAgICAgICAgfSwgdGhpcylcbiAgICAgICAgLm9uKHRoaXMuX3NlYXJjaCwgJ2NsaWNrJywgZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgICBMLkRvbUV2ZW50LnN0b3BQcm9wYWdhdGlvbihlKTtcblxuICAgICAgICAgIC8vIFRvZ2dsZXMgZXhwYW5kZWQgc3RhdGUgb2YgY29udGFpbmVyIG9uIGNsaWNrIG9mIHNlYXJjaCBpY29uXG4gICAgICAgICAgaWYgKEwuRG9tVXRpbC5oYXNDbGFzcyh0aGlzLl9jb250YWluZXIsICdsZWFmbGV0LXBlbGlhcy1leHBhbmRlZCcpKSB7XG4gICAgICAgICAgICAvLyBJZiBleHBhbmRlZCBvcHRpb24gaXMgdHJ1ZSwganVzdCBmb2N1cyB0aGUgaW5wdXRcbiAgICAgICAgICAgIGlmICh0aGlzLm9wdGlvbnMuZXhwYW5kZWQgPT09IHRydWUpIHtcbiAgICAgICAgICAgICAgdGhpcy5faW5wdXQuZm9jdXMoKTtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgLy8gT3RoZXJ3aXNlLCB0b2dnbGUgdG8gaGlkZGVuIHN0YXRlXG4gICAgICAgICAgICAgIEwuRG9tVXRpbC5hZGRDbGFzcyh0aGlzLl9yZXNldCwgJ2xlYWZsZXQtcGVsaWFzLWhpZGRlbicpO1xuICAgICAgICAgICAgICB0aGlzLmNvbGxhcHNlKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIElmIG5vdCBjdXJyZW50bHkgZXhwYW5kZWQsIGNsaWNraW5nIGhlcmUgYWx3YXlzIGV4cGFuZHMgaXRcbiAgICAgICAgICAgIGlmICh0aGlzLl9pbnB1dC52YWx1ZS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgIEwuRG9tVXRpbC5yZW1vdmVDbGFzcyh0aGlzLl9yZXNldCwgJ2xlYWZsZXQtcGVsaWFzLWhpZGRlbicpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5leHBhbmQoKTtcbiAgICAgICAgICAgIHRoaXMuX2lucHV0LmZvY3VzKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9LCB0aGlzKVxuICAgICAgICAub24odGhpcy5fcmVzZXQsICdjbGljaycsIGZ1bmN0aW9uIChlKSB7XG4gICAgICAgICAgdGhpcy5yZXNldCgpO1xuICAgICAgICAgIHRoaXMuX2lucHV0LmZvY3VzKCk7XG4gICAgICAgICAgTC5Eb21FdmVudC5zdG9wUHJvcGFnYXRpb24oZSk7XG4gICAgICAgIH0sIHRoaXMpXG4gICAgICAgIC5vbih0aGlzLl9pbnB1dCwgJ2tleWRvd24nLCBmdW5jdGlvbiAoZSkge1xuICAgICAgICAgIHZhciBsaXN0ID0gdGhpcy5fcmVzdWx0cy5xdWVyeVNlbGVjdG9yQWxsKCcubGVhZmxldC1wZWxpYXMtcmVzdWx0Jyk7XG4gICAgICAgICAgdmFyIHNlbGVjdGVkID0gdGhpcy5fcmVzdWx0cy5xdWVyeVNlbGVjdG9yQWxsKCcubGVhZmxldC1wZWxpYXMtc2VsZWN0ZWQnKVswXTtcbiAgICAgICAgICB2YXIgc2VsZWN0ZWRQb3NpdGlvbjtcbiAgICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgICAgICAgdmFyIHBhblRvUG9pbnQgPSBmdW5jdGlvbiAoc2hvdWxkUGFuKSB7XG4gICAgICAgICAgICB2YXIgX3NlbGVjdGVkID0gc2VsZi5fcmVzdWx0cy5xdWVyeVNlbGVjdG9yQWxsKCcubGVhZmxldC1wZWxpYXMtc2VsZWN0ZWQnKVswXTtcbiAgICAgICAgICAgIGlmIChfc2VsZWN0ZWQgJiYgc2hvdWxkUGFuKSB7XG4gICAgICAgICAgICAgIGlmIChfc2VsZWN0ZWQuZmVhdHVyZS5iYm94KSB7XG4gICAgICAgICAgICAgICAgc2VsZi5yZW1vdmVNYXJrZXJzKCk7XG4gICAgICAgICAgICAgICAgc2VsZi5maXRCb3VuZGluZ0JveChfc2VsZWN0ZWQuZmVhdHVyZS5iYm94KTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzZWxmLnJlbW92ZU1hcmtlcnMoKTtcbiAgICAgICAgICAgICAgICBzZWxmLnNob3dNYXJrZXIoX3NlbGVjdGVkLmlubmVySFRNTCwgTC5HZW9KU09OLmNvb3Jkc1RvTGF0TG5nKF9zZWxlY3RlZC5mZWF0dXJlLmdlb21ldHJ5LmNvb3JkaW5hdGVzKSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9O1xuXG4gICAgICAgICAgdmFyIHNjcm9sbFNlbGVjdGVkUmVzdWx0SW50b1ZpZXcgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgX3NlbGVjdGVkID0gc2VsZi5fcmVzdWx0cy5xdWVyeVNlbGVjdG9yQWxsKCcubGVhZmxldC1wZWxpYXMtc2VsZWN0ZWQnKVswXTtcbiAgICAgICAgICAgIHZhciBfc2VsZWN0ZWRSZWN0ID0gX3NlbGVjdGVkLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICAgICAgdmFyIF9yZXN1bHRzUmVjdCA9IHNlbGYuX3Jlc3VsdHMuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgICAgICAvLyBJcyB0aGUgc2VsZWN0ZWQgZWxlbWVudCBub3QgdmlzaWJsZT9cbiAgICAgICAgICAgIGlmIChfc2VsZWN0ZWRSZWN0LmJvdHRvbSA+IF9yZXN1bHRzUmVjdC5ib3R0b20pIHtcbiAgICAgICAgICAgICAgc2VsZi5fcmVzdWx0cy5zY3JvbGxUb3AgPSBfc2VsZWN0ZWQub2Zmc2V0VG9wICsgX3NlbGVjdGVkLm9mZnNldEhlaWdodCAtIHNlbGYuX3Jlc3VsdHMub2Zmc2V0SGVpZ2h0O1xuICAgICAgICAgICAgfSBlbHNlIGlmIChfc2VsZWN0ZWRSZWN0LnRvcCA8IF9yZXN1bHRzUmVjdC50b3ApIHtcbiAgICAgICAgICAgICAgc2VsZi5fcmVzdWx0cy5zY3JvbGxUb3AgPSBfc2VsZWN0ZWQub2Zmc2V0VG9wO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH07XG5cbiAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChsaXN0W2ldID09PSBzZWxlY3RlZCkge1xuICAgICAgICAgICAgICBzZWxlY3RlZFBvc2l0aW9uID0gaTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gVE9ETyBjbGVhbnVwXG4gICAgICAgICAgc3dpdGNoIChlLmtleUNvZGUpIHtcbiAgICAgICAgICAgIC8vIDEzID0gZW50ZXJcbiAgICAgICAgICAgIGNhc2UgMTM6XG4gICAgICAgICAgICAgIGlmIChzZWxlY3RlZCkge1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0U2VsZWN0ZWRSZXN1bHQoc2VsZWN0ZWQsIGUpO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIHBlcmZvcm0gYSBmdWxsIHRleHQgc2VhcmNoIG9uIGVudGVyXG4gICAgICAgICAgICAgICAgdmFyIHRleHQgPSAoZS50YXJnZXQgfHwgZS5zcmNFbGVtZW50KS52YWx1ZTtcbiAgICAgICAgICAgICAgICB0aGlzLnNlYXJjaCh0ZXh0KTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBMLkRvbUV2ZW50LnByZXZlbnREZWZhdWx0KGUpO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIC8vIDM4ID0gdXAgYXJyb3dcbiAgICAgICAgICAgIGNhc2UgMzg6XG4gICAgICAgICAgICAgIC8vIElnbm9yZSBrZXkgaWYgdGhlcmUgYXJlIG5vIHJlc3VsdHMgb3IgaWYgbGlzdCBpcyBub3QgdmlzaWJsZVxuICAgICAgICAgICAgICBpZiAobGlzdC5sZW5ndGggPT09IDAgfHwgdGhpcy5fcmVzdWx0cy5zdHlsZS5kaXNwbGF5ID09PSAnbm9uZScpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBpZiAoc2VsZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICBMLkRvbVV0aWwucmVtb3ZlQ2xhc3Moc2VsZWN0ZWQsICdsZWFmbGV0LXBlbGlhcy1zZWxlY3RlZCcpO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgdmFyIHByZXZpb3VzSXRlbSA9IGxpc3Rbc2VsZWN0ZWRQb3NpdGlvbiAtIDFdO1xuICAgICAgICAgICAgICB2YXIgaGlnaGxpZ2h0ZWQgPSAoc2VsZWN0ZWQgJiYgcHJldmlvdXNJdGVtKSA/IHByZXZpb3VzSXRlbSA6IGxpc3RbbGlzdC5sZW5ndGggLSAxXTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1yZWRlY2xhcmVcblxuICAgICAgICAgICAgICBMLkRvbVV0aWwuYWRkQ2xhc3MoaGlnaGxpZ2h0ZWQsICdsZWFmbGV0LXBlbGlhcy1zZWxlY3RlZCcpO1xuICAgICAgICAgICAgICBzY3JvbGxTZWxlY3RlZFJlc3VsdEludG9WaWV3KCk7XG4gICAgICAgICAgICAgIHBhblRvUG9pbnQodGhpcy5vcHRpb25zLnBhblRvUG9pbnQpO1xuICAgICAgICAgICAgICB0aGlzLmZpcmUoJ2hpZ2hsaWdodCcsIHtcbiAgICAgICAgICAgICAgICBvcmlnaW5hbEV2ZW50OiBlLFxuICAgICAgICAgICAgICAgIGxhdGxuZzogTC5HZW9KU09OLmNvb3Jkc1RvTGF0TG5nKGhpZ2hsaWdodGVkLmZlYXR1cmUuZ2VvbWV0cnkuY29vcmRpbmF0ZXMpLFxuICAgICAgICAgICAgICAgIGZlYXR1cmU6IGhpZ2hsaWdodGVkLmZlYXR1cmVcbiAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgTC5Eb21FdmVudC5wcmV2ZW50RGVmYXVsdChlKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAvLyA0MCA9IGRvd24gYXJyb3dcbiAgICAgICAgICAgIGNhc2UgNDA6XG4gICAgICAgICAgICAgIC8vIElnbm9yZSBrZXkgaWYgdGhlcmUgYXJlIG5vIHJlc3VsdHMgb3IgaWYgbGlzdCBpcyBub3QgdmlzaWJsZVxuICAgICAgICAgICAgICBpZiAobGlzdC5sZW5ndGggPT09IDAgfHwgdGhpcy5fcmVzdWx0cy5zdHlsZS5kaXNwbGF5ID09PSAnbm9uZScpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBpZiAoc2VsZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICBMLkRvbVV0aWwucmVtb3ZlQ2xhc3Moc2VsZWN0ZWQsICdsZWFmbGV0LXBlbGlhcy1zZWxlY3RlZCcpO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgdmFyIG5leHRJdGVtID0gbGlzdFtzZWxlY3RlZFBvc2l0aW9uICsgMV07XG4gICAgICAgICAgICAgIHZhciBoaWdobGlnaHRlZCA9IChzZWxlY3RlZCAmJiBuZXh0SXRlbSkgPyBuZXh0SXRlbSA6IGxpc3RbMF07IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tcmVkZWNsYXJlXG5cbiAgICAgICAgICAgICAgTC5Eb21VdGlsLmFkZENsYXNzKGhpZ2hsaWdodGVkLCAnbGVhZmxldC1wZWxpYXMtc2VsZWN0ZWQnKTtcbiAgICAgICAgICAgICAgc2Nyb2xsU2VsZWN0ZWRSZXN1bHRJbnRvVmlldygpO1xuICAgICAgICAgICAgICBwYW5Ub1BvaW50KHRoaXMub3B0aW9ucy5wYW5Ub1BvaW50KTtcbiAgICAgICAgICAgICAgdGhpcy5maXJlKCdoaWdobGlnaHQnLCB7XG4gICAgICAgICAgICAgICAgb3JpZ2luYWxFdmVudDogZSxcbiAgICAgICAgICAgICAgICBsYXRsbmc6IEwuR2VvSlNPTi5jb29yZHNUb0xhdExuZyhoaWdobGlnaHRlZC5mZWF0dXJlLmdlb21ldHJ5LmNvb3JkaW5hdGVzKSxcbiAgICAgICAgICAgICAgICBmZWF0dXJlOiBoaWdobGlnaHRlZC5mZWF0dXJlXG4gICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgIEwuRG9tRXZlbnQucHJldmVudERlZmF1bHQoZSk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgLy8gYWxsIG90aGVyIGtleXNcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfSwgdGhpcylcbiAgICAgICAgLm9uKHRoaXMuX2lucHV0LCAna2V5dXAnLCBmdW5jdGlvbiAoZSkge1xuICAgICAgICAgIHZhciBrZXkgPSBlLndoaWNoIHx8IGUua2V5Q29kZTtcbiAgICAgICAgICB2YXIgdGV4dCA9IChlLnRhcmdldCB8fCBlLnNyY0VsZW1lbnQpLnZhbHVlO1xuXG4gICAgICAgICAgaWYgKHRleHQubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgTC5Eb21VdGlsLnJlbW92ZUNsYXNzKHRoaXMuX3Jlc2V0LCAnbGVhZmxldC1wZWxpYXMtaGlkZGVuJyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIEwuRG9tVXRpbC5hZGRDbGFzcyh0aGlzLl9yZXNldCwgJ2xlYWZsZXQtcGVsaWFzLWhpZGRlbicpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIElnbm9yZSBhbGwgZnVydGhlciBhY3Rpb24gaWYgdGhlIGtleWNvZGUgbWF0Y2hlcyBhbiBhcnJvd1xuICAgICAgICAgIC8vIGtleSAoaGFuZGxlZCB2aWEga2V5ZG93biBldmVudClcbiAgICAgICAgICBpZiAoa2V5ID09PSAxMyB8fCBrZXkgPT09IDM4IHx8IGtleSA9PT0gNDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBrZXlDb2RlIDI3ID0gZXNjIGtleSAoZXNjIHNob3VsZCBjbGVhciByZXN1bHRzKVxuICAgICAgICAgIGlmIChrZXkgPT09IDI3KSB7XG4gICAgICAgICAgICAvLyBJZiBpbnB1dCBpcyBibGFuayBvciByZXN1bHRzIGhhdmUgYWxyZWFkeSBiZWVuIGNsZWFyZWRcbiAgICAgICAgICAgIC8vIChwZXJoYXBzIGR1ZSB0byBhIHByZXZpb3VzICdlc2MnKSB0aGVuIHByZXNzaW5nIGVzYyBhdFxuICAgICAgICAgICAgLy8gdGhpcyBwb2ludCB3aWxsIGJsdXIgZnJvbSBpbnB1dCBhcyB3ZWxsLlxuICAgICAgICAgICAgaWYgKHRleHQubGVuZ3RoID09PSAwIHx8IHRoaXMuX3Jlc3VsdHMuc3R5bGUuZGlzcGxheSA9PT0gJ25vbmUnKSB7XG4gICAgICAgICAgICAgIHRoaXMuX2lucHV0LmJsdXIoKTtcblxuICAgICAgICAgICAgICBpZiAoIXRoaXMub3B0aW9ucy5leHBhbmRlZCAmJiBMLkRvbVV0aWwuaGFzQ2xhc3ModGhpcy5fY29udGFpbmVyLCAnbGVhZmxldC1wZWxpYXMtZXhwYW5kZWQnKSkge1xuICAgICAgICAgICAgICAgIHRoaXMuY29sbGFwc2UoKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDbGVhcnMgcmVzdWx0c1xuICAgICAgICAgICAgdGhpcy5jbGVhclJlc3VsdHModHJ1ZSk7XG4gICAgICAgICAgICBMLkRvbVV0aWwucmVtb3ZlQ2xhc3ModGhpcy5fc2VhcmNoLCAnbGVhZmxldC1wZWxpYXMtbG9hZGluZycpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh0ZXh0ICE9PSB0aGlzLl9sYXN0VmFsdWUpIHtcbiAgICAgICAgICAgIHRoaXMuX2xhc3RWYWx1ZSA9IHRleHQ7XG5cbiAgICAgICAgICAgIGlmICh0ZXh0Lmxlbmd0aCA+PSBNSU5JTVVNX0lOUFVUX0xFTkdUSF9GT1JfQVVUT0NPTVBMRVRFICYmIHRoaXMub3B0aW9ucy5hdXRvY29tcGxldGUgPT09IHRydWUpIHtcbiAgICAgICAgICAgICAgdGhpcy5hdXRvY29tcGxldGUodGV4dCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aGlzLmNsZWFyUmVzdWx0cyh0cnVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0sIHRoaXMpXG4gICAgICAgIC5vbih0aGlzLl9yZXN1bHRzLCAnY2xpY2snLCBmdW5jdGlvbiAoZSkge1xuICAgICAgICAgIEwuRG9tRXZlbnQucHJldmVudERlZmF1bHQoZSk7XG4gICAgICAgICAgTC5Eb21FdmVudC5zdG9wUHJvcGFnYXRpb24oZSk7XG5cbiAgICAgICAgICB2YXIgX3NlbGVjdGVkID0gdGhpcy5fcmVzdWx0cy5xdWVyeVNlbGVjdG9yQWxsKCcubGVhZmxldC1wZWxpYXMtc2VsZWN0ZWQnKVswXTtcbiAgICAgICAgICBpZiAoX3NlbGVjdGVkKSB7XG4gICAgICAgICAgICBMLkRvbVV0aWwucmVtb3ZlQ2xhc3MoX3NlbGVjdGVkLCAnbGVhZmxldC1wZWxpYXMtc2VsZWN0ZWQnKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB2YXIgc2VsZWN0ZWQgPSBlLnRhcmdldCB8fCBlLnNyY0VsZW1lbnQ7IC8qIElFOCAqL1xuICAgICAgICAgIHZhciBmaW5kUGFyZW50ID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCFMLkRvbVV0aWwuaGFzQ2xhc3Moc2VsZWN0ZWQsICdsZWFmbGV0LXBlbGlhcy1yZXN1bHQnKSkge1xuICAgICAgICAgICAgICBzZWxlY3RlZCA9IHNlbGVjdGVkLnBhcmVudEVsZW1lbnQ7XG4gICAgICAgICAgICAgIGlmIChzZWxlY3RlZCkge1xuICAgICAgICAgICAgICAgIGZpbmRQYXJlbnQoKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHNlbGVjdGVkO1xuICAgICAgICAgIH07XG5cbiAgICAgICAgICAvLyBjbGljayBldmVudCBjYW4gYmUgcmVnaXN0ZXJlZCBvbiB0aGUgY2hpbGQgbm9kZXNcbiAgICAgICAgICAvLyB0aGF0IGRvZXMgbm90IGhhdmUgdGhlIHJlcXVpcmVkIGNvb3JkcyBwcm9wXG4gICAgICAgICAgLy8gc28gaXRzIGltcG9ydGFudCB0byBmaW5kIHRoZSBwYXJlbnQuXG4gICAgICAgICAgZmluZFBhcmVudCgpO1xuXG4gICAgICAgICAgLy8gSWYgbm90aGluZyBpcyBzZWxlY3RlZCwgKGUuZy4gaXQncyBhIG1lc3NhZ2UsIG5vdCBhIHJlc3VsdCksXG4gICAgICAgICAgLy8gZG8gbm90aGluZy5cbiAgICAgICAgICBpZiAoc2VsZWN0ZWQpIHtcbiAgICAgICAgICAgIEwuRG9tVXRpbC5hZGRDbGFzcyhzZWxlY3RlZCwgJ2xlYWZsZXQtcGVsaWFzLXNlbGVjdGVkJyk7XG4gICAgICAgICAgICB0aGlzLnNldFNlbGVjdGVkUmVzdWx0KHNlbGVjdGVkLCBlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0sIHRoaXMpXG4gICAgICAgIC5vbih0aGlzLl9yZXN1bHRzLCAnbW91c2VvdmVyJywgZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgICAvLyBQcmV2ZW50IHNjcm9sbGluZyBvdmVyIHJlc3VsdHMgbGlzdCBmcm9tIHpvb21pbmcgdGhlIG1hcCwgaWYgZW5hYmxlZFxuICAgICAgICAgIHRoaXMuX3Njcm9sbFdoZWVsWm9vbUVuYWJsZWQgPSBtYXAuc2Nyb2xsV2hlZWxab29tLmVuYWJsZWQoKTtcbiAgICAgICAgICBpZiAodGhpcy5fc2Nyb2xsV2hlZWxab29tRW5hYmxlZCkge1xuICAgICAgICAgICAgbWFwLnNjcm9sbFdoZWVsWm9vbS5kaXNhYmxlKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9LCB0aGlzKVxuICAgICAgICAub24odGhpcy5fcmVzdWx0cywgJ21vdXNlb3V0JywgZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgICAvLyBSZS1lbmFibGUgc2Nyb2xsIHdoZWVsIHpvb20gKGlmIHByZXZpb3VzbHkgZW5hYmxlZCkgYWZ0ZXJcbiAgICAgICAgICAvLyBsZWF2aW5nIHRoZSByZXN1bHRzIGJveFxuICAgICAgICAgIGlmICh0aGlzLl9zY3JvbGxXaGVlbFpvb21FbmFibGVkKSB7XG4gICAgICAgICAgICBtYXAuc2Nyb2xsV2hlZWxab29tLmVuYWJsZSgpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSwgdGhpcyk7XG5cbiAgICAgIC8vIFJlY2FsY3VsYXRlIHdpZHRoIG9mIHRoZSBpbnB1dCBiYXIgd2hlbiB3aW5kb3cgcmVzaXplc1xuICAgICAgaWYgKHRoaXMub3B0aW9ucy5mdWxsV2lkdGgpIHtcbiAgICAgICAgTC5Eb21FdmVudC5vbih3aW5kb3csICdyZXNpemUnLCBmdW5jdGlvbiAoZSkge1xuICAgICAgICAgIGlmIChMLkRvbVV0aWwuaGFzQ2xhc3ModGhpcy5fY29udGFpbmVyLCAnbGVhZmxldC1wZWxpYXMtZXhwYW5kZWQnKSkge1xuICAgICAgICAgICAgdGhpcy5zZXRGdWxsV2lkdGgoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0sIHRoaXMpO1xuICAgICAgfVxuXG4gICAgICBMLkRvbUV2ZW50Lm9uKHRoaXMuX21hcCwgJ21vdXNlZG93bicsIHRoaXMuX29uTWFwSW50ZXJhY3Rpb24sIHRoaXMpO1xuICAgICAgTC5Eb21FdmVudC5vbih0aGlzLl9tYXAsICd0b3VjaHN0YXJ0JywgdGhpcy5fb25NYXBJbnRlcmFjdGlvbiwgdGhpcyk7XG5cbiAgICAgIEwuRG9tRXZlbnQuZGlzYWJsZUNsaWNrUHJvcGFnYXRpb24odGhpcy5fY29udGFpbmVyKTtcbiAgICAgIGlmIChtYXAuYXR0cmlidXRpb25Db250cm9sKSB7XG4gICAgICAgIG1hcC5hdHRyaWJ1dGlvbkNvbnRyb2wuYWRkQXR0cmlidXRpb24odGhpcy5vcHRpb25zLmF0dHJpYnV0aW9uKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBjb250YWluZXI7XG4gICAgfSxcblxuICAgIF9vbk1hcEludGVyYWN0aW9uOiBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgIHRoaXMuYmx1cigpO1xuXG4gICAgICAvLyBPbmx5IGNvbGxhcHNlIGlmIHRoZSBpbnB1dCBpcyBjbGVhciwgYW5kIGlzIGN1cnJlbnRseSBleHBhbmRlZC5cbiAgICAgIC8vIERpc2FibGVkIGlmIGV4cGFuZGVkIGlzIHNldCB0byB0cnVlXG4gICAgICBpZiAoIXRoaXMub3B0aW9ucy5leHBhbmRlZCkge1xuICAgICAgICBpZiAoIXRoaXMuX2lucHV0LnZhbHVlICYmIEwuRG9tVXRpbC5oYXNDbGFzcyh0aGlzLl9jb250YWluZXIsICdsZWFmbGV0LXBlbGlhcy1leHBhbmRlZCcpKSB7XG4gICAgICAgICAgdGhpcy5jb2xsYXBzZSgpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcblxuICAgIG9uUmVtb3ZlOiBmdW5jdGlvbiAobWFwKSB7XG4gICAgICBtYXAuYXR0cmlidXRpb25Db250cm9sLnJlbW92ZUF0dHJpYnV0aW9uKHRoaXMub3B0aW9ucy5hdHRyaWJ1dGlvbik7XG4gICAgfVxuICB9KTtcblxuICBMLmNvbnRyb2wuZ2VvY29kZXIgPSBmdW5jdGlvbiAoYXBpS2V5LCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIG5ldyBMLkNvbnRyb2wuR2VvY29kZXIoYXBpS2V5LCBvcHRpb25zKTtcbiAgfTtcblxuICAvKlxuICAgKiBBSkFYIFV0aWxpdHkgZnVuY3Rpb24gKGltcGxlbWVudHMgYmFzaWMgSFRUUCBnZXQpXG4gICAqL1xuICB2YXIgQUpBWCA9IHtcbiAgICBzZXJpYWxpemU6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgIHZhciBkYXRhID0gJyc7XG5cbiAgICAgIGZvciAodmFyIGtleSBpbiBwYXJhbXMpIHtcbiAgICAgICAgaWYgKHBhcmFtcy5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgdmFyIHBhcmFtID0gcGFyYW1zW2tleV07XG4gICAgICAgICAgdmFyIHR5cGUgPSBwYXJhbS50b1N0cmluZygpO1xuICAgICAgICAgIHZhciB2YWx1ZTtcblxuICAgICAgICAgIGlmIChkYXRhLmxlbmd0aCkge1xuICAgICAgICAgICAgZGF0YSArPSAnJic7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgc3dpdGNoICh0eXBlKSB7XG4gICAgICAgICAgICBjYXNlICdbb2JqZWN0IEFycmF5XSc6XG4gICAgICAgICAgICAgIHZhbHVlID0gKHBhcmFtWzBdLnRvU3RyaW5nKCkgPT09ICdbb2JqZWN0IE9iamVjdF0nKSA/IEpTT04uc3RyaW5naWZ5KHBhcmFtKSA6IHBhcmFtLmpvaW4oJywnKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdbb2JqZWN0IE9iamVjdF0nOlxuICAgICAgICAgICAgICB2YWx1ZSA9IEpTT04uc3RyaW5naWZ5KHBhcmFtKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdbb2JqZWN0IERhdGVdJzpcbiAgICAgICAgICAgICAgdmFsdWUgPSBwYXJhbS52YWx1ZU9mKCk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgdmFsdWUgPSBwYXJhbTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZGF0YSArPSBlbmNvZGVVUklDb21wb25lbnQoa2V5KSArICc9JyArIGVuY29kZVVSSUNvbXBvbmVudCh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGRhdGE7XG4gICAgfSxcbiAgICBodHRwX3JlcXVlc3Q6IGZ1bmN0aW9uIChjYWxsYmFjaywgY29udGV4dCkge1xuICAgICAgaWYgKHdpbmRvdy5YRG9tYWluUmVxdWVzdCkge1xuICAgICAgICByZXR1cm4gdGhpcy54ZHIoY2FsbGJhY2ssIGNvbnRleHQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHRoaXMueGhyKGNhbGxiYWNrLCBjb250ZXh0KTtcbiAgICAgIH1cbiAgICB9LFxuICAgIHhocjogZnVuY3Rpb24gKGNhbGxiYWNrLCBjb250ZXh0KSB7XG4gICAgICB2YXIgeGhyID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XG5cbiAgICAgIHhoci5vbmVycm9yID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgeGhyLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IEwuVXRpbC5mYWxzZUZuO1xuICAgICAgICB2YXIgZXJyb3IgPSB7XG4gICAgICAgICAgY29kZTogeGhyLnN0YXR1cyxcbiAgICAgICAgICBtZXNzYWdlOiB4aHIuc3RhdHVzVGV4dFxuICAgICAgICB9O1xuXG4gICAgICAgIGNhbGxiYWNrLmNhbGwoY29udGV4dCwgZXJyb3IsIG51bGwpO1xuICAgICAgfTtcblxuICAgICAgeGhyLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHJlc3BvbnNlO1xuICAgICAgICB2YXIgZXJyb3I7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXNwb25zZSA9IEpTT04ucGFyc2UoeGhyLnJlc3BvbnNlVGV4dCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICByZXNwb25zZSA9IG51bGw7XG4gICAgICAgICAgZXJyb3IgPSB7XG4gICAgICAgICAgICBjb2RlOiA1MDAsXG4gICAgICAgICAgICBtZXNzYWdlOiAnUGFyc2UgRXJyb3InXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh4aHIucmVhZHlTdGF0ZSA9PT0gNCkge1xuICAgICAgICAgIC8vIEhhbmRsZSBhbGwgbm9uLTIwMCByZXNwb25zZXMgZmlyc3RcbiAgICAgICAgICBpZiAoeGhyLnN0YXR1cyAhPT0gMjAwKSB7XG4gICAgICAgICAgICBlcnJvciA9IHtcbiAgICAgICAgICAgICAgY29kZTogeGhyLnN0YXR1cyxcbiAgICAgICAgICAgICAgbWVzc2FnZTogeGhyLnN0YXR1c1RleHRcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBjYWxsYmFjay5jYWxsKGNvbnRleHQsIGVycm9yLCByZXNwb25zZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmICghZXJyb3IgJiYgcmVzcG9uc2UuZXJyb3IpIHtcbiAgICAgICAgICAgICAgZXJyb3IgPSByZXNwb25zZS5lcnJvcjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgeGhyLm9uZXJyb3IgPSBMLlV0aWwuZmFsc2VGbjtcblxuICAgICAgICAgICAgY2FsbGJhY2suY2FsbChjb250ZXh0LCBlcnJvciwgcmVzcG9uc2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgcmV0dXJuIHhocjtcbiAgICB9LFxuICAgIHhkcjogZnVuY3Rpb24gKGNhbGxiYWNrLCBjb250ZXh0KSB7XG4gICAgICB2YXIgeGRyID0gbmV3IHdpbmRvdy5YRG9tYWluUmVxdWVzdCgpO1xuXG4gICAgICB4ZHIub25lcnJvciA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICAgIHhkci5vbmxvYWQgPSBMLlV0aWwuZmFsc2VGbjtcblxuICAgICAgICAvLyBYRFJzIGhhdmUgbm8gYWNjZXNzIHRvIGFjdHVhbCBzdGF0dXMgY29kZXNcbiAgICAgICAgdmFyIGVycm9yID0ge1xuICAgICAgICAgIGNvZGU6IDUwMCxcbiAgICAgICAgICBtZXNzYWdlOiAnWE1MSHR0cFJlcXVlc3QgRXJyb3InXG4gICAgICAgIH07XG4gICAgICAgIGNhbGxiYWNrLmNhbGwoY29udGV4dCwgZXJyb3IsIG51bGwpO1xuICAgICAgfTtcblxuICAgICAgLy8gWERScyBoYXZlIC5vbmxvYWQgaW5zdGVhZCBvZiAub25yZWFkeXN0YXRlY2hhbmdlXG4gICAgICB4ZHIub25sb2FkID0gZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgcmVzcG9uc2U7XG4gICAgICAgIHZhciBlcnJvcjtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIHJlc3BvbnNlID0gSlNPTi5wYXJzZSh4ZHIucmVzcG9uc2VUZXh0KTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIHJlc3BvbnNlID0gbnVsbDtcbiAgICAgICAgICBlcnJvciA9IHtcbiAgICAgICAgICAgIGNvZGU6IDUwMCxcbiAgICAgICAgICAgIG1lc3NhZ2U6ICdQYXJzZSBFcnJvcidcbiAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFlcnJvciAmJiByZXNwb25zZS5lcnJvcikge1xuICAgICAgICAgIGVycm9yID0gcmVzcG9uc2UuZXJyb3I7XG4gICAgICAgICAgcmVzcG9uc2UgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgeGRyLm9uZXJyb3IgPSBMLlV0aWwuZmFsc2VGbjtcbiAgICAgICAgY2FsbGJhY2suY2FsbChjb250ZXh0LCBlcnJvciwgcmVzcG9uc2UpO1xuICAgICAgfTtcblxuICAgICAgcmV0dXJuIHhkcjtcbiAgICB9LFxuICAgIHJlcXVlc3Q6IGZ1bmN0aW9uICh1cmwsIHBhcmFtcywgY2FsbGJhY2ssIGNvbnRleHQpIHtcbiAgICAgIHZhciBwYXJhbVN0cmluZyA9IHRoaXMuc2VyaWFsaXplKHBhcmFtcyk7XG4gICAgICB2YXIgaHR0cFJlcXVlc3QgPSB0aGlzLmh0dHBfcmVxdWVzdChjYWxsYmFjaywgY29udGV4dCk7XG5cbiAgICAgIGh0dHBSZXF1ZXN0Lm9wZW4oJ0dFVCcsIHVybCArICc/JyArIHBhcmFtU3RyaW5nKTtcbiAgICAgIGlmIChodHRwUmVxdWVzdC5jb25zdHJ1Y3Rvci5uYW1lID09PSAnWE1MSHR0cFJlcXVlc3QnKSB7XG4gICAgICAgIGh0dHBSZXF1ZXN0LnNldFJlcXVlc3RIZWFkZXIoJ0FjY2VwdCcsICdhcHBsaWNhdGlvbi9qc29uJyk7XG4gICAgICB9XG5cbiAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgICBodHRwUmVxdWVzdC5zZW5kKG51bGwpO1xuICAgICAgfSwgMCk7XG4gICAgfVxuICB9O1xuXG4gIC8qXG4gICAqIHRocm90dGxlIFV0aWxpdHkgZnVuY3Rpb24gKGJvcnJvd2VkIGZyb20gdW5kZXJzY29yZSlcbiAgICovXG4gIGZ1bmN0aW9uIHRocm90dGxlIChmdW5jLCB3YWl0LCBvcHRpb25zKSB7XG4gICAgdmFyIGNvbnRleHQsIGFyZ3MsIHJlc3VsdDtcbiAgICB2YXIgdGltZW91dCA9IG51bGw7XG4gICAgdmFyIHByZXZpb3VzID0gMDtcbiAgICBpZiAoIW9wdGlvbnMpIG9wdGlvbnMgPSB7fTtcbiAgICB2YXIgbGF0ZXIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICBwcmV2aW91cyA9IG9wdGlvbnMubGVhZGluZyA9PT0gZmFsc2UgPyAwIDogbmV3IERhdGUoKS5nZXRUaW1lKCk7XG4gICAgICB0aW1lb3V0ID0gbnVsbDtcbiAgICAgIHJlc3VsdCA9IGZ1bmMuYXBwbHkoY29udGV4dCwgYXJncyk7XG4gICAgICBpZiAoIXRpbWVvdXQpIGNvbnRleHQgPSBhcmdzID0gbnVsbDtcbiAgICB9O1xuICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICB2YXIgbm93ID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG4gICAgICBpZiAoIXByZXZpb3VzICYmIG9wdGlvbnMubGVhZGluZyA9PT0gZmFsc2UpIHByZXZpb3VzID0gbm93O1xuICAgICAgdmFyIHJlbWFpbmluZyA9IHdhaXQgLSAobm93IC0gcHJldmlvdXMpO1xuICAgICAgY29udGV4dCA9IHRoaXM7XG4gICAgICBhcmdzID0gYXJndW1lbnRzO1xuICAgICAgaWYgKHJlbWFpbmluZyA8PSAwIHx8IHJlbWFpbmluZyA+IHdhaXQpIHtcbiAgICAgICAgaWYgKHRpbWVvdXQpIHtcbiAgICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICAgICAgdGltZW91dCA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgcHJldmlvdXMgPSBub3c7XG4gICAgICAgIHJlc3VsdCA9IGZ1bmMuYXBwbHkoY29udGV4dCwgYXJncyk7XG4gICAgICAgIGlmICghdGltZW91dCkgY29udGV4dCA9IGFyZ3MgPSBudWxsO1xuICAgICAgfSBlbHNlIGlmICghdGltZW91dCAmJiBvcHRpb25zLnRyYWlsaW5nICE9PSBmYWxzZSkge1xuICAgICAgICB0aW1lb3V0ID0gc2V0VGltZW91dChsYXRlciwgcmVtYWluaW5nKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfTtcbiAgfVxuXG4gIC8qXG4gICAqIGVzY2FwaW5nIGEgc3RyaW5nIGZvciByZWdleCBVdGlsaXR5IGZ1bmN0aW9uXG4gICAqIGZyb20gaHR0cHM6Ly9zdGFja292ZXJmbG93LmNvbS9xdWVzdGlvbnMvMzQ0NjE3MC9lc2NhcGUtc3RyaW5nLWZvci11c2UtaW4tamF2YXNjcmlwdC1yZWdleFxuICAgKi9cbiAgZnVuY3Rpb24gZXNjYXBlUmVnRXhwIChzdHIpIHtcbiAgICByZXR1cm4gc3RyLnJlcGxhY2UoL1tcXC1cXFtcXF1cXC9cXHtcXH1cXChcXClcXCpcXCtcXD9cXC5cXFxcXFxeXFwkXFx8XS9nLCAnXFxcXCQmJyk7XG4gIH1cbn0pKTtcbiIsIi8qIVxuQ29weXJpZ2h0IChjKSAyMDE2IERvbWluaWsgTW9yaXR6XG5cblRoaXMgZmlsZSBpcyBwYXJ0IG9mIHRoZSBsZWFmbGV0IGxvY2F0ZSBjb250cm9sLiBJdCBpcyBsaWNlbnNlZCB1bmRlciB0aGUgTUlUIGxpY2Vuc2UuXG5Zb3UgY2FuIGZpbmQgdGhlIHByb2plY3QgYXQ6IGh0dHBzOi8vZ2l0aHViLmNvbS9kb21vcml0ei9sZWFmbGV0LWxvY2F0ZWNvbnRyb2xcbiovXG4oZnVuY3Rpb24gKGZhY3RvcnksIHdpbmRvdykge1xuICAgICAvLyBzZWUgaHR0cHM6Ly9naXRodWIuY29tL0xlYWZsZXQvTGVhZmxldC9ibG9iL21hc3Rlci9QTFVHSU4tR1VJREUubWQjbW9kdWxlLWxvYWRlcnNcbiAgICAgLy8gZm9yIGRldGFpbHMgb24gaG93IHRvIHN0cnVjdHVyZSBhIGxlYWZsZXQgcGx1Z2luLlxuXG4gICAgLy8gZGVmaW5lIGFuIEFNRCBtb2R1bGUgdGhhdCByZWxpZXMgb24gJ2xlYWZsZXQnXG4gICAgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkge1xuICAgICAgICBkZWZpbmUoWydsZWFmbGV0J10sIGZhY3RvcnkpO1xuXG4gICAgLy8gZGVmaW5lIGEgQ29tbW9uIEpTIG1vZHVsZSB0aGF0IHJlbGllcyBvbiAnbGVhZmxldCdcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0Jykge1xuICAgICAgICBpZiAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgd2luZG93LkwpIHtcbiAgICAgICAgICAgIG1vZHVsZS5leHBvcnRzID0gZmFjdG9yeShMKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG1vZHVsZS5leHBvcnRzID0gZmFjdG9yeSgodHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvd1snTCddIDogdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbFsnTCddIDogbnVsbCkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gYXR0YWNoIHlvdXIgcGx1Z2luIHRvIHRoZSBnbG9iYWwgJ0wnIHZhcmlhYmxlXG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHdpbmRvdy5MKXtcbiAgICAgICAgd2luZG93LkwuQ29udHJvbC5Mb2NhdGUgPSBmYWN0b3J5KEwpO1xuICAgIH1cbn0gKGZ1bmN0aW9uIChMKSB7XG4gICAgdmFyIExvY2F0ZUNvbnRyb2wgPSBMLkNvbnRyb2wuZXh0ZW5kKHtcbiAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgLyoqIFBvc2l0aW9uIG9mIHRoZSBjb250cm9sICovXG4gICAgICAgICAgICBwb3NpdGlvbjogJ3RvcGxlZnQnLFxuICAgICAgICAgICAgLyoqIFRoZSBsYXllciB0aGF0IHRoZSB1c2VyJ3MgbG9jYXRpb24gc2hvdWxkIGJlIGRyYXduIG9uLiBCeSBkZWZhdWx0IGNyZWF0ZXMgYSBuZXcgbGF5ZXIuICovXG4gICAgICAgICAgICBsYXllcjogdW5kZWZpbmVkLFxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKiBBdXRvbWF0aWNhbGx5IHNldHMgdGhlIG1hcCB2aWV3ICh6b29tIGFuZCBwYW4pIHRvIHRoZSB1c2VyJ3MgbG9jYXRpb24gYXMgaXQgdXBkYXRlcy5cbiAgICAgICAgICAgICAqIFdoaWxlIHRoZSBtYXAgaXMgZm9sbG93aW5nIHRoZSB1c2VyJ3MgbG9jYXRpb24sIHRoZSBjb250cm9sIGlzIGluIHRoZSBgZm9sbG93aW5nYCBzdGF0ZSxcbiAgICAgICAgICAgICAqIHdoaWNoIGNoYW5nZXMgdGhlIHN0eWxlIG9mIHRoZSBjb250cm9sIGFuZCB0aGUgY2lyY2xlIG1hcmtlci5cbiAgICAgICAgICAgICAqXG4gICAgICAgICAgICAgKiBQb3NzaWJsZSB2YWx1ZXM6XG4gICAgICAgICAgICAgKiAgLSBmYWxzZTogbmV2ZXIgdXBkYXRlcyB0aGUgbWFwIHZpZXcgd2hlbiBsb2NhdGlvbiBjaGFuZ2VzLlxuICAgICAgICAgICAgICogIC0gJ29uY2UnOiBzZXQgdGhlIHZpZXcgd2hlbiB0aGUgbG9jYXRpb24gaXMgZmlyc3QgZGV0ZXJtaW5lZFxuICAgICAgICAgICAgICogIC0gJ2Fsd2F5cyc6IGFsd2F5cyB1cGRhdGVzIHRoZSBtYXAgdmlldyB3aGVuIGxvY2F0aW9uIGNoYW5nZXMuXG4gICAgICAgICAgICAgKiAgICAgICAgICAgICAgVGhlIG1hcCB2aWV3IGZvbGxvd3MgdGhlIHVzZXJzIGxvY2F0aW9uLlxuICAgICAgICAgICAgICogIC0gJ3VudGlsUGFuJzogKGRlZmF1bHQpIGxpa2UgJ2Fsd2F5cycsIGV4Y2VwdCBzdG9wcyB1cGRhdGluZyB0aGVcbiAgICAgICAgICAgICAqICAgICAgICAgICAgICAgIHZpZXcgaWYgdGhlIHVzZXIgaGFzIG1hbnVhbGx5IHBhbm5lZCB0aGUgbWFwLlxuICAgICAgICAgICAgICogICAgICAgICAgICAgICAgVGhlIG1hcCB2aWV3IGZvbGxvd3MgdGhlIHVzZXJzIGxvY2F0aW9uIHVudGlsIHNoZSBwYW5zLlxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBzZXRWaWV3OiAndW50aWxQYW4nLFxuICAgICAgICAgICAgLyoqIEtlZXAgdGhlIGN1cnJlbnQgbWFwIHpvb20gbGV2ZWwgd2hlbiBzZXR0aW5nIHRoZSB2aWV3IGFuZCBvbmx5IHBhbi4gKi9cbiAgICAgICAgICAgIGtlZXBDdXJyZW50Wm9vbUxldmVsOiBmYWxzZSxcbiAgICAgICAgICAgIC8qKiBTbW9vdGggcGFuIGFuZCB6b29tIHRvIHRoZSBsb2NhdGlvbiBvZiB0aGUgbWFya2VyLiBPbmx5IHdvcmtzIGluIExlYWZsZXQgMS4wKy4gKi9cbiAgICAgICAgICAgIGZseVRvOiBmYWxzZSxcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogVGhlIHVzZXIgbG9jYXRpb24gY2FuIGJlIGluc2lkZSBhbmQgb3V0c2lkZSB0aGUgY3VycmVudCB2aWV3IHdoZW4gdGhlIHVzZXIgY2xpY2tzIG9uIHRoZVxuICAgICAgICAgICAgICogY29udHJvbCB0aGF0IGlzIGFscmVhZHkgYWN0aXZlLiBCb3RoIGNhc2VzIGNhbiBiZSBjb25maWd1cmVzIHNlcGFyYXRlbHkuXG4gICAgICAgICAgICAgKiBQb3NzaWJsZSB2YWx1ZXMgYXJlOlxuICAgICAgICAgICAgICogIC0gJ3NldFZpZXcnOiB6b29tIGFuZCBwYW4gdG8gdGhlIGN1cnJlbnQgbG9jYXRpb25cbiAgICAgICAgICAgICAqICAtICdzdG9wJzogc3RvcCBsb2NhdGluZyBhbmQgcmVtb3ZlIHRoZSBsb2NhdGlvbiBtYXJrZXJcbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgY2xpY2tCZWhhdmlvcjoge1xuICAgICAgICAgICAgICAgIC8qKiBXaGF0IHNob3VsZCBoYXBwZW4gaWYgdGhlIHVzZXIgY2xpY2tzIG9uIHRoZSBjb250cm9sIHdoaWxlIHRoZSBsb2NhdGlvbiBpcyB3aXRoaW4gdGhlIGN1cnJlbnQgdmlldy4gKi9cbiAgICAgICAgICAgICAgICBpblZpZXc6ICdzdG9wJyxcbiAgICAgICAgICAgICAgICAvKiogV2hhdCBzaG91bGQgaGFwcGVuIGlmIHRoZSB1c2VyIGNsaWNrcyBvbiB0aGUgY29udHJvbCB3aGlsZSB0aGUgbG9jYXRpb24gaXMgb3V0c2lkZSB0aGUgY3VycmVudCB2aWV3LiAqL1xuICAgICAgICAgICAgICAgIG91dE9mVmlldzogJ3NldFZpZXcnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogSWYgc2V0LCBzYXZlIHRoZSBtYXAgYm91bmRzIGp1c3QgYmVmb3JlIGNlbnRlcmluZyB0byB0aGUgdXNlcidzXG4gICAgICAgICAgICAgKiBsb2NhdGlvbi4gV2hlbiBjb250cm9sIGlzIGRpc2FibGVkLCBzZXQgdGhlIHZpZXcgYmFjayB0byB0aGVcbiAgICAgICAgICAgICAqIGJvdW5kcyB0aGF0IHdlcmUgc2F2ZWQuXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIHJldHVyblRvUHJldkJvdW5kczogZmFsc2UsXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIEtlZXAgYSBjYWNoZSBvZiB0aGUgbG9jYXRpb24gYWZ0ZXIgdGhlIHVzZXIgZGVhY3RpdmF0ZXMgdGhlIGNvbnRyb2wuIElmIHNldCB0byBmYWxzZSwgdGhlIHVzZXIgaGFzIHRvIHdhaXRcbiAgICAgICAgICAgICAqIHVudGlsIHRoZSBsb2NhdGUgQVBJIHJldHVybnMgYSBuZXcgbG9jYXRpb24gYmVmb3JlIHRoZXkgc2VlIHdoZXJlIHRoZXkgYXJlIGFnYWluLlxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBjYWNoZUxvY2F0aW9uOiB0cnVlLFxuICAgICAgICAgICAgLyoqIElmIHNldCwgYSBjaXJjbGUgdGhhdCBzaG93cyB0aGUgbG9jYXRpb24gYWNjdXJhY3kgaXMgZHJhd24uICovXG4gICAgICAgICAgICBkcmF3Q2lyY2xlOiB0cnVlLFxuICAgICAgICAgICAgLyoqIElmIHNldCwgdGhlIG1hcmtlciBhdCB0aGUgdXNlcnMnIGxvY2F0aW9uIGlzIGRyYXduLiAqL1xuICAgICAgICAgICAgZHJhd01hcmtlcjogdHJ1ZSxcbiAgICAgICAgICAgIC8qKiBUaGUgY2xhc3MgdG8gYmUgdXNlZCB0byBjcmVhdGUgdGhlIG1hcmtlci4gRm9yIGV4YW1wbGUgTC5DaXJjbGVNYXJrZXIgb3IgTC5NYXJrZXIgKi9cbiAgICAgICAgICAgIG1hcmtlckNsYXNzOiBMLkNpcmNsZU1hcmtlcixcbiAgICAgICAgICAgIC8qKiBBY2N1cmFjeSBjaXJjbGUgc3R5bGUgcHJvcGVydGllcy4gKi9cbiAgICAgICAgICAgIGNpcmNsZVN0eWxlOiB7XG4gICAgICAgICAgICAgICAgY29sb3I6ICcjMTM2QUVDJyxcbiAgICAgICAgICAgICAgICBmaWxsQ29sb3I6ICcjMTM2QUVDJyxcbiAgICAgICAgICAgICAgICBmaWxsT3BhY2l0eTogMC4xNSxcbiAgICAgICAgICAgICAgICB3ZWlnaHQ6IDIsXG4gICAgICAgICAgICAgICAgb3BhY2l0eTogMC41XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLyoqIElubmVyIG1hcmtlciBzdHlsZSBwcm9wZXJ0aWVzLiBPbmx5IHdvcmtzIGlmIHlvdXIgbWFya2VyIGNsYXNzIHN1cHBvcnRzIGBzZXRTdHlsZWAuICovXG4gICAgICAgICAgICBtYXJrZXJTdHlsZToge1xuICAgICAgICAgICAgICAgIGNvbG9yOiAnIzEzNkFFQycsXG4gICAgICAgICAgICAgICAgZmlsbENvbG9yOiAnIzJBOTNFRScsXG4gICAgICAgICAgICAgICAgZmlsbE9wYWNpdHk6IDAuNyxcbiAgICAgICAgICAgICAgICB3ZWlnaHQ6IDIsXG4gICAgICAgICAgICAgICAgb3BhY2l0eTogMC45LFxuICAgICAgICAgICAgICAgIHJhZGl1czogNVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogQ2hhbmdlcyB0byBhY2N1cmFjeSBjaXJjbGUgYW5kIGlubmVyIG1hcmtlciB3aGlsZSBmb2xsb3dpbmcuXG4gICAgICAgICAgICAgKiBJdCBpcyBvbmx5IG5lY2Vzc2FyeSB0byBwcm92aWRlIHRoZSBwcm9wZXJ0aWVzIHRoYXQgc2hvdWxkIGNoYW5nZS5cbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgZm9sbG93Q2lyY2xlU3R5bGU6IHt9LFxuICAgICAgICAgICAgZm9sbG93TWFya2VyU3R5bGU6IHtcbiAgICAgICAgICAgICAgICAvLyBjb2xvcjogJyNGRkE1MDAnLFxuICAgICAgICAgICAgICAgIC8vIGZpbGxDb2xvcjogJyNGRkIwMDAnXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLyoqIFRoZSBDU1MgY2xhc3MgZm9yIHRoZSBpY29uLiBGb3IgZXhhbXBsZSBmYS1sb2NhdGlvbi1hcnJvdyBvciBmYS1tYXAtbWFya2VyICovXG4gICAgICAgICAgICBpY29uOiAnZmEgZmEtbWFwLW1hcmtlcicsXG4gICAgICAgICAgICBpY29uTG9hZGluZzogJ2ZhIGZhLXNwaW5uZXIgZmEtc3BpbicsXG4gICAgICAgICAgICAvKiogVGhlIGVsZW1lbnQgdG8gYmUgY3JlYXRlZCBmb3IgaWNvbnMuIEZvciBleGFtcGxlIHNwYW4gb3IgaSAqL1xuICAgICAgICAgICAgaWNvbkVsZW1lbnRUYWc6ICdzcGFuJyxcbiAgICAgICAgICAgIC8qKiBQYWRkaW5nIGFyb3VuZCB0aGUgYWNjdXJhY3kgY2lyY2xlLiAqL1xuICAgICAgICAgICAgY2lyY2xlUGFkZGluZzogWzAsIDBdLFxuICAgICAgICAgICAgLyoqIFVzZSBtZXRyaWMgdW5pdHMuICovXG4gICAgICAgICAgICBtZXRyaWM6IHRydWUsXG4gICAgICAgICAgICAvKiogVGhpcyBldmVudCBpcyBjYWxsZWQgaW4gY2FzZSBvZiBhbnkgbG9jYXRpb24gZXJyb3IgdGhhdCBpcyBub3QgYSB0aW1lIG91dCBlcnJvci4gKi9cbiAgICAgICAgICAgIG9uTG9jYXRpb25FcnJvcjogZnVuY3Rpb24oZXJyLCBjb250cm9sKSB7XG4gICAgICAgICAgICAgICAgYWxlcnQoZXJyLm1lc3NhZ2UpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogVGhpcyBldmVuIGlzIGNhbGxlZCB3aGVuIHRoZSB1c2VyJ3MgbG9jYXRpb24gaXMgb3V0c2lkZSB0aGUgYm91bmRzIHNldCBvbiB0aGUgbWFwLlxuICAgICAgICAgICAgICogVGhlIGV2ZW50IGlzIGNhbGxlZCByZXBlYXRlZGx5IHdoZW4gdGhlIGxvY2F0aW9uIGNoYW5nZXMuXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIG9uTG9jYXRpb25PdXRzaWRlTWFwQm91bmRzOiBmdW5jdGlvbihjb250cm9sKSB7XG4gICAgICAgICAgICAgICAgY29udHJvbC5zdG9wKCk7XG4gICAgICAgICAgICAgICAgYWxlcnQoY29udHJvbC5vcHRpb25zLnN0cmluZ3Mub3V0c2lkZU1hcEJvdW5kc01zZyk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLyoqIERpc3BsYXkgYSBwb3AtdXAgd2hlbiB0aGUgdXNlciBjbGljayBvbiB0aGUgaW5uZXIgbWFya2VyLiAqL1xuICAgICAgICAgICAgc2hvd1BvcHVwOiB0cnVlLFxuICAgICAgICAgICAgc3RyaW5nczoge1xuICAgICAgICAgICAgICAgIHRpdGxlOiBcIlNob3cgbWUgd2hlcmUgSSBhbVwiLFxuICAgICAgICAgICAgICAgIG1ldGVyc1VuaXQ6IFwibWV0ZXJzXCIsXG4gICAgICAgICAgICAgICAgZmVldFVuaXQ6IFwiZmVldFwiLFxuICAgICAgICAgICAgICAgIHBvcHVwOiBcIllvdSBhcmUgd2l0aGluIHtkaXN0YW5jZX0ge3VuaXR9IGZyb20gdGhpcyBwb2ludFwiLFxuICAgICAgICAgICAgICAgIG91dHNpZGVNYXBCb3VuZHNNc2c6IFwiWW91IHNlZW0gbG9jYXRlZCBvdXRzaWRlIHRoZSBib3VuZGFyaWVzIG9mIHRoZSBtYXBcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8qKiBUaGUgZGVmYXVsdCBvcHRpb25zIHBhc3NlZCB0byBsZWFmbGV0cyBsb2NhdGUgbWV0aG9kLiAqL1xuICAgICAgICAgICAgbG9jYXRlT3B0aW9uczoge1xuICAgICAgICAgICAgICAgIG1heFpvb206IEluZmluaXR5LFxuICAgICAgICAgICAgICAgIHdhdGNoOiB0cnVlLCAgLy8gaWYgeW91IG92ZXJ3cml0ZSB0aGlzLCB2aXN1YWxpemF0aW9uIGNhbm5vdCBiZSB1cGRhdGVkXG4gICAgICAgICAgICAgICAgc2V0VmlldzogZmFsc2UgLy8gaGF2ZSB0byBzZXQgdGhpcyB0byBmYWxzZSBiZWNhdXNlIHdlIGhhdmUgdG9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBkbyBzZXRWaWV3IG1hbnVhbGx5XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG5cbiAgICAgICAgaW5pdGlhbGl6ZTogZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICAgICAgICAgIC8vIHNldCBkZWZhdWx0IG9wdGlvbnMgaWYgbm90aGluZyBpcyBzZXQgKG1lcmdlIG9uZSBzdGVwIGRlZXApXG4gICAgICAgICAgICBmb3IgKHZhciBpIGluIG9wdGlvbnMpIHtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHRoaXMub3B0aW9uc1tpXSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICAgICAgTC5leHRlbmQodGhpcy5vcHRpb25zW2ldLCBvcHRpb25zW2ldKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm9wdGlvbnNbaV0gPSBvcHRpb25zW2ldO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gZXh0ZW5kIHRoZSBmb2xsb3cgbWFya2VyIHN0eWxlIGFuZCBjaXJjbGUgZnJvbSB0aGUgbm9ybWFsIHN0eWxlXG4gICAgICAgICAgICB0aGlzLm9wdGlvbnMuZm9sbG93TWFya2VyU3R5bGUgPSBMLmV4dGVuZCh7fSwgdGhpcy5vcHRpb25zLm1hcmtlclN0eWxlLCB0aGlzLm9wdGlvbnMuZm9sbG93TWFya2VyU3R5bGUpO1xuICAgICAgICAgICAgdGhpcy5vcHRpb25zLmZvbGxvd0NpcmNsZVN0eWxlID0gTC5leHRlbmQoe30sIHRoaXMub3B0aW9ucy5jaXJjbGVTdHlsZSwgdGhpcy5vcHRpb25zLmZvbGxvd0NpcmNsZVN0eWxlKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogQWRkIGNvbnRyb2wgdG8gbWFwLiBSZXR1cm5zIHRoZSBjb250YWluZXIgZm9yIHRoZSBjb250cm9sLlxuICAgICAgICAgKi9cbiAgICAgICAgb25BZGQ6IGZ1bmN0aW9uIChtYXApIHtcbiAgICAgICAgICAgIHZhciBjb250YWluZXIgPSBMLkRvbVV0aWwuY3JlYXRlKCdkaXYnLFxuICAgICAgICAgICAgICAgICdsZWFmbGV0LWNvbnRyb2wtbG9jYXRlIGxlYWZsZXQtYmFyIGxlYWZsZXQtY29udHJvbCcpO1xuXG4gICAgICAgICAgICB0aGlzLl9sYXllciA9IHRoaXMub3B0aW9ucy5sYXllciB8fCBuZXcgTC5MYXllckdyb3VwKCk7XG4gICAgICAgICAgICB0aGlzLl9sYXllci5hZGRUbyhtYXApO1xuICAgICAgICAgICAgdGhpcy5fZXZlbnQgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl9wcmV2Qm91bmRzID0gbnVsbDtcblxuICAgICAgICAgICAgdGhpcy5fbGluayA9IEwuRG9tVXRpbC5jcmVhdGUoJ2EnLCAnbGVhZmxldC1iYXItcGFydCBsZWFmbGV0LWJhci1wYXJ0LXNpbmdsZScsIGNvbnRhaW5lcik7XG4gICAgICAgICAgICB0aGlzLl9saW5rLnRpdGxlID0gdGhpcy5vcHRpb25zLnN0cmluZ3MudGl0bGU7XG4gICAgICAgICAgICB0aGlzLl9pY29uID0gTC5Eb21VdGlsLmNyZWF0ZSh0aGlzLm9wdGlvbnMuaWNvbkVsZW1lbnRUYWcsIHRoaXMub3B0aW9ucy5pY29uLCB0aGlzLl9saW5rKTtcblxuICAgICAgICAgICAgTC5Eb21FdmVudFxuICAgICAgICAgICAgICAgIC5vbih0aGlzLl9saW5rLCAnY2xpY2snLCBMLkRvbUV2ZW50LnN0b3BQcm9wYWdhdGlvbilcbiAgICAgICAgICAgICAgICAub24odGhpcy5fbGluaywgJ2NsaWNrJywgTC5Eb21FdmVudC5wcmV2ZW50RGVmYXVsdClcbiAgICAgICAgICAgICAgICAub24odGhpcy5fbGluaywgJ2NsaWNrJywgdGhpcy5fb25DbGljaywgdGhpcylcbiAgICAgICAgICAgICAgICAub24odGhpcy5fbGluaywgJ2RibGNsaWNrJywgTC5Eb21FdmVudC5zdG9wUHJvcGFnYXRpb24pO1xuXG4gICAgICAgICAgICB0aGlzLl9yZXNldFZhcmlhYmxlcygpO1xuXG4gICAgICAgICAgICB0aGlzLl9tYXAub24oJ3VubG9hZCcsIHRoaXMuX3VubG9hZCwgdGhpcyk7XG5cbiAgICAgICAgICAgIHJldHVybiBjb250YWluZXI7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoaXMgbWV0aG9kIGlzIGNhbGxlZCB3aGVuIHRoZSB1c2VyIGNsaWNrcyBvbiB0aGUgY29udHJvbC5cbiAgICAgICAgICovXG4gICAgICAgIF9vbkNsaWNrOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHRoaXMuX2p1c3RDbGlja2VkID0gdHJ1ZTtcbiAgICAgICAgICAgIHRoaXMuX3VzZXJQYW5uZWQgPSBmYWxzZTtcblxuICAgICAgICAgICAgaWYgKHRoaXMuX2FjdGl2ZSAmJiAhdGhpcy5fZXZlbnQpIHtcbiAgICAgICAgICAgICAgICAvLyBjbGljayB3aGlsZSByZXF1ZXN0aW5nXG4gICAgICAgICAgICAgICAgdGhpcy5zdG9wKCk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX2FjdGl2ZSAmJiB0aGlzLl9ldmVudCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgdmFyIGJlaGF2aW9yID0gdGhpcy5fbWFwLmdldEJvdW5kcygpLmNvbnRhaW5zKHRoaXMuX2V2ZW50LmxhdGxuZykgP1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm9wdGlvbnMuY2xpY2tCZWhhdmlvci5pblZpZXcgOiB0aGlzLm9wdGlvbnMuY2xpY2tCZWhhdmlvci5vdXRPZlZpZXc7XG4gICAgICAgICAgICAgICAgc3dpdGNoIChiZWhhdmlvcikge1xuICAgICAgICAgICAgICAgICAgICBjYXNlICdzZXRWaWV3JzpcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2V0VmlldygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgJ3N0b3AnOlxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zdG9wKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5vcHRpb25zLnJldHVyblRvUHJldkJvdW5kcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciBmID0gdGhpcy5vcHRpb25zLmZseVRvID8gdGhpcy5fbWFwLmZseVRvQm91bmRzIDogdGhpcy5fbWFwLmZpdEJvdW5kcztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmLmJpbmQodGhpcy5fbWFwKSh0aGlzLl9wcmV2Qm91bmRzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMub3B0aW9ucy5yZXR1cm5Ub1ByZXZCb3VuZHMpIHtcbiAgICAgICAgICAgICAgICAgIHRoaXMuX3ByZXZCb3VuZHMgPSB0aGlzLl9tYXAuZ2V0Qm91bmRzKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRoaXMuc3RhcnQoKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5fdXBkYXRlQ29udGFpbmVyU3R5bGUoKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogU3RhcnRzIHRoZSBwbHVnaW46XG4gICAgICAgICAqIC0gYWN0aXZhdGVzIHRoZSBlbmdpbmVcbiAgICAgICAgICogLSBkcmF3cyB0aGUgbWFya2VyIChpZiBjb29yZGluYXRlcyBhdmFpbGFibGUpXG4gICAgICAgICAqL1xuICAgICAgICBzdGFydDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB0aGlzLl9hY3RpdmF0ZSgpO1xuXG4gICAgICAgICAgICBpZiAodGhpcy5fZXZlbnQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9kcmF3TWFya2VyKHRoaXMuX21hcCk7XG5cbiAgICAgICAgICAgICAgICAvLyBpZiB3ZSBhbHJlYWR5IGhhdmUgYSBsb2NhdGlvbiBidXQgdGhlIHVzZXIgY2xpY2tlZCBvbiB0aGUgY29udHJvbFxuICAgICAgICAgICAgICAgIGlmICh0aGlzLm9wdGlvbnMuc2V0Vmlldykge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnNldFZpZXcoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLl91cGRhdGVDb250YWluZXJTdHlsZSgpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBTdG9wcyB0aGUgcGx1Z2luOlxuICAgICAgICAgKiAtIGRlYWN0aXZhdGVzIHRoZSBlbmdpbmVcbiAgICAgICAgICogLSByZWluaXRpYWxpemVzIHRoZSBidXR0b25cbiAgICAgICAgICogLSByZW1vdmVzIHRoZSBtYXJrZXJcbiAgICAgICAgICovXG4gICAgICAgIHN0b3A6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdGhpcy5fZGVhY3RpdmF0ZSgpO1xuXG4gICAgICAgICAgICB0aGlzLl9jbGVhbkNsYXNzZXMoKTtcbiAgICAgICAgICAgIHRoaXMuX3Jlc2V0VmFyaWFibGVzKCk7XG5cbiAgICAgICAgICAgIHRoaXMuX3JlbW92ZU1hcmtlcigpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGlzIG1ldGhvZCBsYXVuY2hlcyB0aGUgbG9jYXRpb24gZW5naW5lLlxuICAgICAgICAgKiBJdCBpcyBjYWxsZWQgYmVmb3JlIHRoZSBtYXJrZXIgaXMgdXBkYXRlZCxcbiAgICAgICAgICogZXZlbnQgaWYgaXQgZG9lcyBub3QgbWVhbiB0aGF0IHRoZSBldmVudCB3aWxsIGJlIHJlYWR5LlxuICAgICAgICAgKlxuICAgICAgICAgKiBPdmVycmlkZSBpdCBpZiB5b3Ugd2FudCB0byBhZGQgbW9yZSBmdW5jdGlvbmFsaXRpZXMuXG4gICAgICAgICAqIEl0IHNob3VsZCBzZXQgdGhlIHRoaXMuX2FjdGl2ZSB0byB0cnVlIGFuZCBkbyBub3RoaW5nIGlmXG4gICAgICAgICAqIHRoaXMuX2FjdGl2ZSBpcyB0cnVlLlxuICAgICAgICAgKi9cbiAgICAgICAgX2FjdGl2YXRlOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5fYWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwLmxvY2F0ZSh0aGlzLm9wdGlvbnMubG9jYXRlT3B0aW9ucyk7XG4gICAgICAgICAgICAgICAgdGhpcy5fYWN0aXZlID0gdHJ1ZTtcblxuICAgICAgICAgICAgICAgIC8vIGJpbmQgZXZlbnQgbGlzdGVuZXJzXG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwLm9uKCdsb2NhdGlvbmZvdW5kJywgdGhpcy5fb25Mb2NhdGlvbkZvdW5kLCB0aGlzKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXAub24oJ2xvY2F0aW9uZXJyb3InLCB0aGlzLl9vbkxvY2F0aW9uRXJyb3IsIHRoaXMpO1xuICAgICAgICAgICAgICAgIHRoaXMuX21hcC5vbignZHJhZ3N0YXJ0JywgdGhpcy5fb25EcmFnLCB0aGlzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogQ2FsbGVkIHRvIHN0b3AgdGhlIGxvY2F0aW9uIGVuZ2luZS5cbiAgICAgICAgICpcbiAgICAgICAgICogT3ZlcnJpZGUgaXQgdG8gc2h1dGRvd24gYW55IGZ1bmN0aW9uYWxpdGllcyB5b3UgYWRkZWQgb24gc3RhcnQuXG4gICAgICAgICAqL1xuICAgICAgICBfZGVhY3RpdmF0ZTogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB0aGlzLl9tYXAuc3RvcExvY2F0ZSgpO1xuICAgICAgICAgICAgdGhpcy5fYWN0aXZlID0gZmFsc2U7XG5cbiAgICAgICAgICAgIGlmICghdGhpcy5vcHRpb25zLmNhY2hlTG9jYXRpb24pIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9ldmVudCA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gdW5iaW5kIGV2ZW50IGxpc3RlbmVyc1xuICAgICAgICAgICAgdGhpcy5fbWFwLm9mZignbG9jYXRpb25mb3VuZCcsIHRoaXMuX29uTG9jYXRpb25Gb3VuZCwgdGhpcyk7XG4gICAgICAgICAgICB0aGlzLl9tYXAub2ZmKCdsb2NhdGlvbmVycm9yJywgdGhpcy5fb25Mb2NhdGlvbkVycm9yLCB0aGlzKTtcbiAgICAgICAgICAgIHRoaXMuX21hcC5vZmYoJ2RyYWdzdGFydCcsIHRoaXMuX29uRHJhZywgdGhpcyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFpvb20gKHVubGVzcyB3ZSBzaG91bGQga2VlcCB0aGUgem9vbSBsZXZlbCkgYW5kIGFuIHRvIHRoZSBjdXJyZW50IHZpZXcuXG4gICAgICAgICAqL1xuICAgICAgICBzZXRWaWV3OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHRoaXMuX2RyYXdNYXJrZXIoKTtcbiAgICAgICAgICAgIGlmICh0aGlzLl9pc091dHNpZGVNYXBCb3VuZHMoKSkge1xuICAgICAgICAgICAgICAgIHRoaXMuX2V2ZW50ID0gdW5kZWZpbmVkOyAgLy8gY2xlYXIgdGhlIGN1cnJlbnQgbG9jYXRpb24gc28gd2UgY2FuIGdldCBiYWNrIGludG8gdGhlIGJvdW5kc1xuICAgICAgICAgICAgICAgIHRoaXMub3B0aW9ucy5vbkxvY2F0aW9uT3V0c2lkZU1hcEJvdW5kcyh0aGlzKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMub3B0aW9ucy5rZWVwQ3VycmVudFpvb21MZXZlbCkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZiA9IHRoaXMub3B0aW9ucy5mbHlUbyA/IHRoaXMuX21hcC5mbHlUbyA6IHRoaXMuX21hcC5wYW5UbztcbiAgICAgICAgICAgICAgICAgICAgZi5iaW5kKHRoaXMuX21hcCkoW3RoaXMuX2V2ZW50LmxhdGl0dWRlLCB0aGlzLl9ldmVudC5sb25naXR1ZGVdKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZiA9IHRoaXMub3B0aW9ucy5mbHlUbyA/IHRoaXMuX21hcC5mbHlUb0JvdW5kcyA6IHRoaXMuX21hcC5maXRCb3VuZHM7XG4gICAgICAgICAgICAgICAgICAgIGYuYmluZCh0aGlzLl9tYXApKHRoaXMuX2V2ZW50LmJvdW5kcywge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGFkZGluZzogdGhpcy5vcHRpb25zLmNpcmNsZVBhZGRpbmcsXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXhab29tOiB0aGlzLm9wdGlvbnMubG9jYXRlT3B0aW9ucy5tYXhab29tXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogRHJhdyB0aGUgbWFya2VyIGFuZCBhY2N1cmFjeSBjaXJjbGUgb24gdGhlIG1hcC5cbiAgICAgICAgICpcbiAgICAgICAgICogVXNlcyB0aGUgZXZlbnQgcmV0cmlldmVkIGZyb20gb25Mb2NhdGlvbkZvdW5kIGZyb20gdGhlIG1hcC5cbiAgICAgICAgICovXG4gICAgICAgIF9kcmF3TWFya2VyOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLl9ldmVudC5hY2N1cmFjeSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fZXZlbnQuYWNjdXJhY3kgPSAwO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgcmFkaXVzID0gdGhpcy5fZXZlbnQuYWNjdXJhY3k7XG4gICAgICAgICAgICB2YXIgbGF0bG5nID0gdGhpcy5fZXZlbnQubGF0bG5nO1xuXG4gICAgICAgICAgICAvLyBjaXJjbGUgd2l0aCB0aGUgcmFkaXVzIG9mIHRoZSBsb2NhdGlvbidzIGFjY3VyYWN5XG4gICAgICAgICAgICBpZiAodGhpcy5vcHRpb25zLmRyYXdDaXJjbGUpIHtcbiAgICAgICAgICAgICAgICB2YXIgc3R5bGUgPSB0aGlzLl9pc0ZvbGxvd2luZygpID8gdGhpcy5vcHRpb25zLmZvbGxvd0NpcmNsZVN0eWxlIDogdGhpcy5vcHRpb25zLmNpcmNsZVN0eWxlO1xuXG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9jaXJjbGUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY2lyY2xlID0gTC5jaXJjbGUobGF0bG5nLCByYWRpdXMsIHN0eWxlKS5hZGRUbyh0aGlzLl9sYXllcik7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY2lyY2xlLnNldExhdExuZyhsYXRsbmcpLnNldFJhZGl1cyhyYWRpdXMpLnNldFN0eWxlKHN0eWxlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBkaXN0YW5jZSwgdW5pdDtcbiAgICAgICAgICAgIGlmICh0aGlzLm9wdGlvbnMubWV0cmljKSB7XG4gICAgICAgICAgICAgICAgZGlzdGFuY2UgPSByYWRpdXMudG9GaXhlZCgwKTtcbiAgICAgICAgICAgICAgICB1bml0ID0gIHRoaXMub3B0aW9ucy5zdHJpbmdzLm1ldGVyc1VuaXQ7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGRpc3RhbmNlID0gKHJhZGl1cyAqIDMuMjgwODM5OSkudG9GaXhlZCgwKTtcbiAgICAgICAgICAgICAgICB1bml0ID0gdGhpcy5vcHRpb25zLnN0cmluZ3MuZmVldFVuaXQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIHNtYWxsIGlubmVyIG1hcmtlclxuICAgICAgICAgICAgaWYgKHRoaXMub3B0aW9ucy5kcmF3TWFya2VyKSB7XG4gICAgICAgICAgICAgICAgdmFyIG1TdHlsZSA9IHRoaXMuX2lzRm9sbG93aW5nKCkgPyB0aGlzLm9wdGlvbnMuZm9sbG93TWFya2VyU3R5bGUgOiB0aGlzLm9wdGlvbnMubWFya2VyU3R5bGU7XG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9tYXJrZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fbWFya2VyID0gbmV3IHRoaXMub3B0aW9ucy5tYXJrZXJDbGFzcyhsYXRsbmcsIG1TdHlsZSkuYWRkVG8odGhpcy5fbGF5ZXIpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX21hcmtlci5zZXRMYXRMbmcobGF0bG5nKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgdGhlIG1hcmtlckNsYXNzIGNhbiBiZSB1cGRhdGVkIHdpdGggc2V0U3R5bGUsIHVwZGF0ZSBpdC5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX21hcmtlci5zZXRTdHlsZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fbWFya2VyLnNldFN0eWxlKG1TdHlsZSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciB0ID0gdGhpcy5vcHRpb25zLnN0cmluZ3MucG9wdXA7XG4gICAgICAgICAgICBpZiAodGhpcy5vcHRpb25zLnNob3dQb3B1cCAmJiB0ICYmIHRoaXMuX21hcmtlcikge1xuICAgICAgICAgICAgICAgIHRoaXMuX21hcmtlclxuICAgICAgICAgICAgICAgICAgICAuYmluZFBvcHVwKEwuVXRpbC50ZW1wbGF0ZSh0LCB7ZGlzdGFuY2U6IGRpc3RhbmNlLCB1bml0OiB1bml0fSkpXG4gICAgICAgICAgICAgICAgICAgIC5fcG9wdXAuc2V0TGF0TG5nKGxhdGxuZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFJlbW92ZSB0aGUgbWFya2VyIGZyb20gbWFwLlxuICAgICAgICAgKi9cbiAgICAgICAgX3JlbW92ZU1hcmtlcjogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB0aGlzLl9sYXllci5jbGVhckxheWVycygpO1xuICAgICAgICAgICAgdGhpcy5fbWFya2VyID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fY2lyY2xlID0gdW5kZWZpbmVkO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBVbmxvYWQgdGhlIHBsdWdpbiBhbmQgYWxsIGV2ZW50IGxpc3RlbmVycy5cbiAgICAgICAgICogS2luZCBvZiB0aGUgb3Bwb3NpdGUgb2Ygb25BZGQuXG4gICAgICAgICAqL1xuICAgICAgICBfdW5sb2FkOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHRoaXMuc3RvcCgpO1xuICAgICAgICAgICAgdGhpcy5fbWFwLm9mZigndW5sb2FkJywgdGhpcy5fdW5sb2FkLCB0aGlzKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogQ2FsbHMgZGVhY3RpdmF0ZSBhbmQgZGlzcGF0Y2hlcyBhbiBlcnJvci5cbiAgICAgICAgICovXG4gICAgICAgIF9vbkxvY2F0aW9uRXJyb3I6IGZ1bmN0aW9uKGVycikge1xuICAgICAgICAgICAgLy8gaWdub3JlIHRpbWUgb3V0IGVycm9yIGlmIHRoZSBsb2NhdGlvbiBpcyB3YXRjaGVkXG4gICAgICAgICAgICBpZiAoZXJyLmNvZGUgPT0gMyAmJiB0aGlzLm9wdGlvbnMubG9jYXRlT3B0aW9ucy53YXRjaCkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5zdG9wKCk7XG4gICAgICAgICAgICB0aGlzLm9wdGlvbnMub25Mb2NhdGlvbkVycm9yKGVyciwgdGhpcyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFN0b3JlcyB0aGUgcmVjZWl2ZWQgZXZlbnQgYW5kIHVwZGF0ZXMgdGhlIG1hcmtlci5cbiAgICAgICAgICovXG4gICAgICAgIF9vbkxvY2F0aW9uRm91bmQ6IGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgICAgIC8vIG5vIG5lZWQgdG8gZG8gYW55dGhpbmcgaWYgdGhlIGxvY2F0aW9uIGhhcyBub3QgY2hhbmdlZFxuICAgICAgICAgICAgaWYgKHRoaXMuX2V2ZW50ICYmXG4gICAgICAgICAgICAgICAgKHRoaXMuX2V2ZW50LmxhdGxuZy5sYXQgPT09IGUubGF0bG5nLmxhdCAmJlxuICAgICAgICAgICAgICAgICB0aGlzLl9ldmVudC5sYXRsbmcubG5nID09PSBlLmxhdGxuZy5sbmcgJiZcbiAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2V2ZW50LmFjY3VyYWN5ID09PSBlLmFjY3VyYWN5KSkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCF0aGlzLl9hY3RpdmUpIHtcbiAgICAgICAgICAgICAgICAvLyB3ZSBtYXkgaGF2ZSBhIHN0cmF5IGV2ZW50XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLl9ldmVudCA9IGU7XG5cbiAgICAgICAgICAgIHRoaXMuX2RyYXdNYXJrZXIoKTtcbiAgICAgICAgICAgIHRoaXMuX3VwZGF0ZUNvbnRhaW5lclN0eWxlKCk7XG5cbiAgICAgICAgICAgIHN3aXRjaCAodGhpcy5vcHRpb25zLnNldFZpZXcpIHtcbiAgICAgICAgICAgICAgICBjYXNlICdvbmNlJzpcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX2p1c3RDbGlja2VkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNldFZpZXcoKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICd1bnRpbFBhbic6XG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5fdXNlclBhbm5lZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zZXRWaWV3KCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAnYWx3YXlzJzpcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5zZXRWaWV3KCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgZmFsc2U6XG4gICAgICAgICAgICAgICAgICAgIC8vIGRvbid0IHNldCB0aGUgdmlld1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5fanVzdENsaWNrZWQgPSBmYWxzZTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogV2hlbiB0aGUgdXNlciBkcmFncy4gTmVlZCBhIHNlcGFyYXRlIGV2ZW4gc28gd2UgY2FuIGJpbmQgYW5kIHVuYmluZCBldmVuIGxpc3RlbmVycy5cbiAgICAgICAgICovXG4gICAgICAgIF9vbkRyYWc6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgLy8gb25seSByZWFjdCB0byBkcmFncyBvbmNlIHdlIGhhdmUgYSBsb2NhdGlvblxuICAgICAgICAgICAgaWYgKHRoaXMuX2V2ZW50KSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fdXNlclBhbm5lZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGhpcy5fdXBkYXRlQ29udGFpbmVyU3R5bGUoKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9kcmF3TWFya2VyKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIENvbXB1dGUgd2hldGhlciB0aGUgbWFwIGlzIGZvbGxvd2luZyB0aGUgdXNlciBsb2NhdGlvbiB3aXRoIHBhbiBhbmQgem9vbS5cbiAgICAgICAgICovXG4gICAgICAgIF9pc0ZvbGxvd2luZzogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuX2FjdGl2ZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHRoaXMub3B0aW9ucy5zZXRWaWV3ID09PSAnYWx3YXlzJykge1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0aGlzLm9wdGlvbnMuc2V0VmlldyA9PT0gJ3VudGlsUGFuJykge1xuICAgICAgICAgICAgICAgIHJldHVybiAhdGhpcy5fdXNlclBhbm5lZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogQ2hlY2sgaWYgbG9jYXRpb24gaXMgaW4gbWFwIGJvdW5kc1xuICAgICAgICAgKi9cbiAgICAgICAgX2lzT3V0c2lkZU1hcEJvdW5kczogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5fZXZlbnQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9tYXAub3B0aW9ucy5tYXhCb3VuZHMgJiZcbiAgICAgICAgICAgICAgICAhdGhpcy5fbWFwLm9wdGlvbnMubWF4Qm91bmRzLmNvbnRhaW5zKHRoaXMuX2V2ZW50LmxhdGxuZyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRvZ2dsZXMgYnV0dG9uIGNsYXNzIGJldHdlZW4gZm9sbG93aW5nIGFuZCBhY3RpdmUuXG4gICAgICAgICAqL1xuICAgICAgICBfdXBkYXRlQ29udGFpbmVyU3R5bGU6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgaWYgKCF0aGlzLl9jb250YWluZXIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICh0aGlzLl9hY3RpdmUgJiYgIXRoaXMuX2V2ZW50KSB7XG4gICAgICAgICAgICAgICAgLy8gYWN0aXZlIGJ1dCBkb24ndCBoYXZlIGEgbG9jYXRpb24geWV0XG4gICAgICAgICAgICAgICAgdGhpcy5fc2V0Q2xhc3NlcygncmVxdWVzdGluZycpO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0aGlzLl9pc0ZvbGxvd2luZygpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fc2V0Q2xhc3NlcygnZm9sbG93aW5nJyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX2FjdGl2ZSkge1xuICAgICAgICAgICAgICAgIHRoaXMuX3NldENsYXNzZXMoJ2FjdGl2ZScpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9jbGVhbkNsYXNzZXMoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogU2V0cyB0aGUgQ1NTIGNsYXNzZXMgZm9yIHRoZSBzdGF0ZS5cbiAgICAgICAgICovXG4gICAgICAgIF9zZXRDbGFzc2VzOiBmdW5jdGlvbihzdGF0ZSkge1xuICAgICAgICAgICAgaWYgKHN0YXRlID09ICdyZXF1ZXN0aW5nJykge1xuICAgICAgICAgICAgICAgIEwuRG9tVXRpbC5yZW1vdmVDbGFzc2VzKHRoaXMuX2NvbnRhaW5lciwgXCJhY3RpdmUgZm9sbG93aW5nXCIpO1xuICAgICAgICAgICAgICAgIEwuRG9tVXRpbC5hZGRDbGFzc2VzKHRoaXMuX2NvbnRhaW5lciwgXCJyZXF1ZXN0aW5nXCIpO1xuXG4gICAgICAgICAgICAgICAgTC5Eb21VdGlsLnJlbW92ZUNsYXNzZXModGhpcy5faWNvbiwgdGhpcy5vcHRpb25zLmljb24pO1xuICAgICAgICAgICAgICAgIEwuRG9tVXRpbC5hZGRDbGFzc2VzKHRoaXMuX2ljb24sIHRoaXMub3B0aW9ucy5pY29uTG9hZGluZyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHN0YXRlID09ICdhY3RpdmUnKSB7XG4gICAgICAgICAgICAgICAgTC5Eb21VdGlsLnJlbW92ZUNsYXNzZXModGhpcy5fY29udGFpbmVyLCBcInJlcXVlc3RpbmcgZm9sbG93aW5nXCIpO1xuICAgICAgICAgICAgICAgIEwuRG9tVXRpbC5hZGRDbGFzc2VzKHRoaXMuX2NvbnRhaW5lciwgXCJhY3RpdmVcIik7XG5cbiAgICAgICAgICAgICAgICBMLkRvbVV0aWwucmVtb3ZlQ2xhc3Nlcyh0aGlzLl9pY29uLCB0aGlzLm9wdGlvbnMuaWNvbkxvYWRpbmcpO1xuICAgICAgICAgICAgICAgIEwuRG9tVXRpbC5hZGRDbGFzc2VzKHRoaXMuX2ljb24sIHRoaXMub3B0aW9ucy5pY29uKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc3RhdGUgPT0gJ2ZvbGxvd2luZycpIHtcbiAgICAgICAgICAgICAgICBMLkRvbVV0aWwucmVtb3ZlQ2xhc3Nlcyh0aGlzLl9jb250YWluZXIsIFwicmVxdWVzdGluZ1wiKTtcbiAgICAgICAgICAgICAgICBMLkRvbVV0aWwuYWRkQ2xhc3Nlcyh0aGlzLl9jb250YWluZXIsIFwiYWN0aXZlIGZvbGxvd2luZ1wiKTtcblxuICAgICAgICAgICAgICAgIEwuRG9tVXRpbC5yZW1vdmVDbGFzc2VzKHRoaXMuX2ljb24sIHRoaXMub3B0aW9ucy5pY29uTG9hZGluZyk7XG4gICAgICAgICAgICAgICAgTC5Eb21VdGlsLmFkZENsYXNzZXModGhpcy5faWNvbiwgdGhpcy5vcHRpb25zLmljb24pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBSZW1vdmVzIGFsbCBjbGFzc2VzIGZyb20gYnV0dG9uLlxuICAgICAgICAgKi9cbiAgICAgICAgX2NsZWFuQ2xhc3NlczogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBMLkRvbVV0aWwucmVtb3ZlQ2xhc3ModGhpcy5fY29udGFpbmVyLCBcInJlcXVlc3RpbmdcIik7XG4gICAgICAgICAgICBMLkRvbVV0aWwucmVtb3ZlQ2xhc3ModGhpcy5fY29udGFpbmVyLCBcImFjdGl2ZVwiKTtcbiAgICAgICAgICAgIEwuRG9tVXRpbC5yZW1vdmVDbGFzcyh0aGlzLl9jb250YWluZXIsIFwiZm9sbG93aW5nXCIpO1xuXG4gICAgICAgICAgICBMLkRvbVV0aWwucmVtb3ZlQ2xhc3Nlcyh0aGlzLl9pY29uLCB0aGlzLm9wdGlvbnMuaWNvbkxvYWRpbmcpO1xuICAgICAgICAgICAgTC5Eb21VdGlsLmFkZENsYXNzZXModGhpcy5faWNvbiwgdGhpcy5vcHRpb25zLmljb24pO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBSZWluaXRpYWxpemVzIHN0YXRlIHZhcmlhYmxlcy5cbiAgICAgICAgICovXG4gICAgICAgIF9yZXNldFZhcmlhYmxlczogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAvLyB3aGV0aGVyIGxvY2F0ZSBpcyBhY3RpdmUgb3Igbm90XG4gICAgICAgICAgICB0aGlzLl9hY3RpdmUgPSBmYWxzZTtcblxuICAgICAgICAgICAgLy8gdHJ1ZSBpZiB0aGUgY29udHJvbCB3YXMgY2xpY2tlZCBmb3IgdGhlIGZpcnN0IHRpbWVcbiAgICAgICAgICAgIC8vIHdlIG5lZWQgdGhpcyBzbyB3ZSBjYW4gcGFuIGFuZCB6b29tIG9uY2Ugd2UgaGF2ZSB0aGUgbG9jYXRpb25cbiAgICAgICAgICAgIHRoaXMuX2p1c3RDbGlja2VkID0gZmFsc2U7XG5cbiAgICAgICAgICAgIC8vIHRydWUgaWYgdGhlIHVzZXIgaGFzIHBhbm5lZCB0aGUgbWFwIGFmdGVyIGNsaWNraW5nIHRoZSBjb250cm9sXG4gICAgICAgICAgICB0aGlzLl91c2VyUGFubmVkID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIEwuY29udHJvbC5sb2NhdGUgPSBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgICAgICByZXR1cm4gbmV3IEwuQ29udHJvbC5Mb2NhdGUob3B0aW9ucyk7XG4gICAgfTtcblxuICAgIChmdW5jdGlvbigpe1xuICAgICAgLy8gbGVhZmxldC5qcyByYWlzZXMgYnVnIHdoZW4gdHJ5aW5nIHRvIGFkZENsYXNzIC8gcmVtb3ZlQ2xhc3MgbXVsdGlwbGUgY2xhc3NlcyBhdCBvbmNlXG4gICAgICAvLyBMZXQncyBjcmVhdGUgYSB3cmFwcGVyIG9uIGl0IHdoaWNoIGZpeGVzIGl0LlxuICAgICAgdmFyIExEb21VdGlsQXBwbHlDbGFzc2VzTWV0aG9kID0gZnVuY3Rpb24obWV0aG9kLCBlbGVtZW50LCBjbGFzc05hbWVzKSB7XG4gICAgICAgIGNsYXNzTmFtZXMgPSBjbGFzc05hbWVzLnNwbGl0KCcgJyk7XG4gICAgICAgIGNsYXNzTmFtZXMuZm9yRWFjaChmdW5jdGlvbihjbGFzc05hbWUpIHtcbiAgICAgICAgICAgIEwuRG9tVXRpbFttZXRob2RdLmNhbGwodGhpcywgZWxlbWVudCwgY2xhc3NOYW1lKTtcbiAgICAgICAgfSk7XG4gICAgICB9O1xuXG4gICAgICBMLkRvbVV0aWwuYWRkQ2xhc3NlcyA9IGZ1bmN0aW9uKGVsLCBuYW1lcykgeyBMRG9tVXRpbEFwcGx5Q2xhc3Nlc01ldGhvZCgnYWRkQ2xhc3MnLCBlbCwgbmFtZXMpOyB9O1xuICAgICAgTC5Eb21VdGlsLnJlbW92ZUNsYXNzZXMgPSBmdW5jdGlvbihlbCwgbmFtZXMpIHsgTERvbVV0aWxBcHBseUNsYXNzZXNNZXRob2QoJ3JlbW92ZUNsYXNzJywgZWwsIG5hbWVzKTsgfTtcbiAgICB9KSgpO1xuXG4gICAgcmV0dXJuIExvY2F0ZUNvbnRyb2w7XG59LCB3aW5kb3cpKTtcbiIsIi8vIChjKSAyMDE3IE1hcHplblxuLy9cbi8vIE1BUFpFTiBTQ0FSQUIgKGFrYSBCVUcgZm9yIFVTIEJST0FEQ0FTVCBURUxFVklTSU9OIGFuZCBET0cgaW4gdGhlIFVLKVxuLy8gaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9EaWdpdGFsX29uLXNjcmVlbl9ncmFwaGljXG4vL1xuLy8gSWRlbnRpZmllcyBmdWxsLXNjcmVlbiBkZW1vIHBhZ2VzIHdpdGggTWFwemVuIGJyYW5kIGFuZCBwcm92aWRlcyBoZWxwZnVsXG4vLyBzb2NpYWwgbWVkaWEgbGlua3MuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vKiBnbG9iYWwgbW9kdWxlLCBnYSAqL1xudmFyIE1hcHplblNjYXJhYiA9IChmdW5jdGlvbiAoKSB7XG4gICd1c2Ugc3RyaWN0J1xuXG4gIHZhciBERUZBVUxUX0xJTksgPSAnaHR0cHM6Ly9tYXB6ZW4uY29tLydcbiAgdmFyIFRSQUNLSU5HX0NBVEVHT1JZID0gJ2RlbW8nXG4gIHZhciBBTkFMWVRJQ1NfUFJPUEVSVFlfSUQgPSAnVUEtNDcwMzU4MTEtMSdcblxuICAvLyBHbG9iYWxzXG4gIHZhciBvcHRzXG4gICAgLy8gb3B0cy5uYW1lICAgICAgTmFtZSBvZiBkZW1vXG4gICAgLy8gb3B0cy5saW5rICAgICAgTGluayB0byBnbyB0b1xuICAgIC8vIG9wdHMudHdlZXQgICAgIHByZXdyaXR0ZW4gdHdlZXRcbiAgICAvLyBvcHRzLmFuYWx5dGljcyB0cmFjaz9cbiAgICAvLyBvcHRzLnJlcG8gICAgICBMaW5rIHRvIEdpdEh1YiByZXBvc2l0b3J5XG4gICAgLy8gb3B0cy5kZXNjcmlwdGlvbiBJbmZvcm1hdGlvbiBhYm91dCBtYXBcblxuICB2YXIgaW5mb0Rlc2NyaXB0aW9uRWxcblxuICBmdW5jdGlvbiBfdHJhY2sgKGFjdGlvbiwgbGFiZWwsIHZhbHVlLCBub25JbnRlcmFjdGlvbikge1xuICAgIGlmIChvcHRzLmFuYWx5dGljcyA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuXG4gICAgaWYgKHR5cGVvZiBnYSA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGdhKCdzZW5kJywgJ2V2ZW50JywgVFJBQ0tJTkdfQ0FURUdPUlksIGFjdGlvbiwgbGFiZWwsIHZhbHVlLCBub25JbnRlcmFjdGlvbilcbiAgfVxuXG4gIGZ1bmN0aW9uIF9sb2FkQW5hbHl0aWNzICgpIHtcbiAgICAvKiBlc2xpbnQtZGlzYWJsZSAqL1xuICAgIChmdW5jdGlvbihpLHMsbyxnLHIsYSxtKXtpWydHb29nbGVBbmFseXRpY3NPYmplY3QnXT1yO2lbcl09aVtyXXx8ZnVuY3Rpb24oKXtcbiAgICAoaVtyXS5xPWlbcl0ucXx8W10pLnB1c2goYXJndW1lbnRzKX0saVtyXS5sPTEqbmV3IERhdGUoKTthPXMuY3JlYXRlRWxlbWVudChvKSxcbiAgICBtPXMuZ2V0RWxlbWVudHNCeVRhZ05hbWUobylbMF07YS5hc3luYz0xO2Euc3JjPWc7bS5wYXJlbnROb2RlLmluc2VydEJlZm9yZShhLG0pXG4gICAgfSkod2luZG93LGRvY3VtZW50LCdzY3JpcHQnLCcvL3d3dy5nb29nbGUtYW5hbHl0aWNzLmNvbS9hbmFseXRpY3MuanMnLCdnYScpO1xuXG4gICAgZ2EoJ2NyZWF0ZScsIEFOQUxZVElDU19QUk9QRVJUWV9JRCwgJ2F1dG8nKTtcbiAgICBnYSgnc2VuZCcsICdwYWdldmlldycpO1xuICAgIC8qIGVzbGludC1lbmFibGUgKi9cbiAgfVxuXG4gIGZ1bmN0aW9uIF9wb3B1cFdpbmRvdyAodXJsLCB0aXRsZSwgdywgaCkge1xuICAgIC8vIEJvcnJvd2VkIGZyb20gcnJzc2JcbiAgICAvLyBGaXhlcyBkdWFsLXNjcmVlbiBwb3NpdGlvbiAgICAgICAgICAgICAgICAgICAgICAgICBNb3N0IGJyb3dzZXJzICAgICAgRmlyZWZveFxuICAgIHZhciBkdWFsU2NyZWVuTGVmdCA9IHdpbmRvdy5zY3JlZW5MZWZ0ICE9PSB1bmRlZmluZWQgPyB3aW5kb3cuc2NyZWVuTGVmdCA6IHdpbmRvdy5zY3JlZW4ubGVmdFxuICAgIHZhciBkdWFsU2NyZWVuVG9wID0gd2luZG93LnNjcmVlblRvcCAhPT0gdW5kZWZpbmVkID8gd2luZG93LnNjcmVlblRvcCA6IHdpbmRvdy5zY3JlZW4udG9wXG5cbiAgICB2YXIgd2lkdGggPSB3aW5kb3cuaW5uZXJXaWR0aCA/IHdpbmRvdy5pbm5lcldpZHRoIDogZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmNsaWVudFdpZHRoID8gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmNsaWVudFdpZHRoIDogd2luZG93LnNjcmVlbi53aWR0aFxuICAgIHZhciBoZWlnaHQgPSB3aW5kb3cuaW5uZXJIZWlnaHQgPyB3aW5kb3cuaW5uZXJIZWlnaHQgOiBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuY2xpZW50SGVpZ2h0ID8gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmNsaWVudEhlaWdodCA6IHdpbmRvdy5zY3JlZW4uaGVpZ2h0XG5cbiAgICB2YXIgbGVmdCA9ICgod2lkdGggLyAyKSAtICh3IC8gMikpICsgZHVhbFNjcmVlbkxlZnRcbiAgICB2YXIgdG9wID0gKChoZWlnaHQgLyAzKSAtIChoIC8gMykpICsgZHVhbFNjcmVlblRvcFxuXG4gICAgdmFyIG5ld1dpbmRvdyA9IHdpbmRvdy5vcGVuKHVybCwgdGl0bGUsICdzY3JvbGxiYXJzPXllcywgd2lkdGg9JyArIHcgKyAnLCBoZWlnaHQ9JyArIGggKyAnLCB0b3A9JyArIHRvcCArICcsIGxlZnQ9JyArIGxlZnQpXG5cbiAgICAvLyBQdXRzIGZvY3VzIG9uIHRoZSBuZXdXaW5kb3dcbiAgICBpZiAod2luZG93LmZvY3VzKSB7XG4gICAgICBuZXdXaW5kb3cuZm9jdXMoKVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIF9idWlsZFR3aXR0ZXJMaW5rICgpIHtcbiAgICB2YXIgYmFzZSA9ICdodHRwczovL3R3aXR0ZXIuY29tL2ludGVudC90d2VldCdcbiAgICB2YXIgdXJsID0gZW5jb2RlVVJJQ29tcG9uZW50KHdpbmRvdy5sb2NhdGlvbi5ocmVmKVxuICAgIHZhciB0ZXh0XG4gICAgdmFyIHBhcmFtc1xuXG4gICAgaWYgKG9wdHMudHdlZXQpIHtcbiAgICAgIHRleHQgPSBlbmNvZGVVUklDb21wb25lbnQob3B0cy50d2VldClcbiAgICB9IGVsc2UgaWYgKG9wdHMubmFtZSkge1xuICAgICAgdGV4dCA9IGVuY29kZVVSSUNvbXBvbmVudChvcHRzLm5hbWUgKyAnLCBwb3dlcmVkIGJ5IEBtYXB6ZW4nKVxuICAgIH0gZWxzZSB7XG4gICAgICB0ZXh0ID0gZW5jb2RlVVJJQ29tcG9uZW50KCdDaGVjayBvdXQgdGhpcyBwcm9qZWN0IGJ5IEBtYXB6ZW4hJylcbiAgICB9XG5cbiAgICBwYXJhbXMgPSAnP3RleHQ9JyArIHRleHQgKyAnJnVybD0nICsgdXJsXG4gICAgcmV0dXJuIGJhc2UgKyBwYXJhbXNcbiAgfVxuXG4gIGZ1bmN0aW9uIF9idWlsZEZhY2Vib29rTGluayAoKSB7XG4gICAgdmFyIGJhc2UgPSAnaHR0cHM6Ly93d3cuZmFjZWJvb2suY29tL3NoYXJlci9zaGFyZXIucGhwP3U9J1xuICAgIHZhciB1cmwgPSBlbmNvZGVVUklDb21wb25lbnQod2luZG93LmxvY2F0aW9uLmhyZWYpXG4gICAgcmV0dXJuIGJhc2UgKyB1cmxcbiAgfVxuXG4gIGZ1bmN0aW9uIF9jcmVhdGVFbHNBbmRBcHBlbmQgKCkge1xuICAgIHZhciBtYXB6ZW5MaW5rID0gb3B0cy5saW5rIHx8IERFRkFVTFRfTElOS1xuICAgIHZhciBtYXB6ZW5UaXRsZSA9IChvcHRzLm5hbWUpID8gb3B0cy5uYW1lICsgJyDCtyBQb3dlcmVkIGJ5IE1hcHplbicgOiAnUG93ZXJlZCBieSBNYXB6ZW4nXG4gICAgdmFyIGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JylcblxuICAgIC8vIENyZWF0ZSBjb250YWluZXJcbiAgICBlbC5pZCA9ICdtei1idWcnXG4gICAgZWwuY2xhc3NOYW1lID0gJ216LWJ1Zy1jb250YWluZXInXG4gICAgZWwuc2V0QXR0cmlidXRlKCdyb2xlJywgJ3dpZGdldCcpXG5cbiAgICAvLyBDcmVhdGUgYnV0dG9uc1xuICAgIHZhciBtYXB6ZW5FbCA9IF9jcmVhdGVCdXR0b25FbCgnbWFwemVuJywgbWFwemVuTGluaywgbWFwemVuVGl0bGUsIF9vbkNsaWNrTWFwemVuKVxuICAgIHZhciB0d2l0dGVyRWwgPSBfY3JlYXRlQnV0dG9uRWwoJ3R3aXR0ZXInLCBfYnVpbGRUd2l0dGVyTGluaygpLCAnU2hhcmUgdGhpcyBvbiBUd2l0dGVyJywgX29uQ2xpY2tUd2l0dGVyKVxuICAgIHZhciBmYWNlYm9va0VsID0gX2NyZWF0ZUJ1dHRvbkVsKCdmYWNlYm9vaycsIF9idWlsZEZhY2Vib29rTGluaygpLCAnU2hhcmUgdGhpcyBvbiBGYWNlYm9vaycsIF9vbkNsaWNrRmFjZWJvb2spXG5cbiAgICAvLyBCdWlsZCBET01cbiAgICBlbC5hcHBlbmRDaGlsZChtYXB6ZW5FbClcbiAgICBlbC5hcHBlbmRDaGlsZCh0d2l0dGVyRWwpXG4gICAgZWwuYXBwZW5kQ2hpbGQoZmFjZWJvb2tFbClcblxuICAgIC8vIENyZWF0aW5nIGdpdGh1YiBpY29uIGJ1dHRvbiBpZiBuZWVkZWRcbiAgICBpZiAob3B0cy5yZXBvKSB7XG4gICAgICB2YXIgZ2l0aHViRWwgPSBfY3JlYXRlQnV0dG9uRWwoJ2dpdGh1YicsIG9wdHMucmVwbywgJ1ZpZXcgc291cmNlIG9uIEdpdEh1YicsIF9vbkNsaWNrR2l0SHViKVxuICAgICAgZWwuYXBwZW5kQ2hpbGQoZ2l0aHViRWwpXG4gICAgfVxuXG4gICAgLy8gQ3JlYXRpbmcgaW5mbyBidXR0b24gYW5kIGFkZGluZyB0byBjb250YWluZXIgb25seSBpZiBkZXNjcmlwdGlvbiBpcyBwcm92aWRlZFxuICAgIGlmIChvcHRzLmRlc2NyaXB0aW9uKSB7XG4gICAgICB2YXIgaW5mb0VsID0gX2NyZWF0ZUluZm9CdXR0b24oJ2luZm8nLCBfb25DbGlja0luZm8pXG4gICAgICBlbC5hcHBlbmRDaGlsZChpbmZvRWwpXG4gICAgfVxuXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbClcbiAgICByZXR1cm4gZWxcbiAgfVxuXG4gIGZ1bmN0aW9uIF9jcmVhdGVJbmZvQnV0dG9uKGlkLCBjbGlja0hhbmRsZXIpIHtcbiAgICB2YXIgaW5mb0J1dHRvbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpXG4gICAgdmFyIGluZm9Mb2dvID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JylcbiAgICBpbmZvTG9nby5jbGFzc05hbWUgPSAnbXotYnVnLScgKyBpZCArICctbG9nbydcbiAgICBpbmZvTG9nby5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGNsaWNrSGFuZGxlcilcbiAgICBpbmZvQnV0dG9uLmNsYXNzTmFtZSA9ICdtei1idWctJyArIGlkXG4gICAgaW5mb0J1dHRvbi5jbGFzc05hbWUgKz0gJyBtei1idWctaWNvbnMnXG5cbiAgICBpbmZvQnV0dG9uLmFwcGVuZENoaWxkKGluZm9Mb2dvKVxuICAgIHJldHVybiBpbmZvQnV0dG9uXG4gIH1cblxuICBmdW5jdGlvbiBfY3JlYXRlQnV0dG9uRWwgKGlkLCBsaW5rSHJlZiwgbGlua1RpdGxlLCBjbGlja0hhbmRsZXIpIHtcbiAgICB2YXIgbGlua0VsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpXG4gICAgdmFyIGxvZ29FbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpXG5cbiAgICBsb2dvRWwuY2xhc3NOYW1lID0gJ216LWJ1Zy0nICsgaWQgKyAnLWxvZ28nXG4gICAgbGlua0VsLmhyZWYgPSBsaW5rSHJlZlxuICAgIGxpbmtFbC50YXJnZXQgPSAnX2JsYW5rJ1xuICAgIGxpbmtFbC5jbGFzc05hbWUgPSAnbXotYnVnLScgKyBpZCArICctbGluaydcbiAgICBsaW5rRWwuY2xhc3NOYW1lICs9ICcgbXotYnVnLWljb25zJ1xuICAgIGxpbmtFbC50aXRsZSA9IGxpbmtUaXRsZVxuICAgIGxpbmtFbC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGNsaWNrSGFuZGxlcilcblxuICAgIGxpbmtFbC5hcHBlbmRDaGlsZChsb2dvRWwpXG4gICAgcmV0dXJuIGxpbmtFbFxuICB9XG5cbiAgZnVuY3Rpb24gX29uQ2xpY2tNYXB6ZW4gKGV2ZW50KSB7XG4gICAgX3RyYWNrKCdjbGljaycsICdtYXB6ZW4gbG9nbycsIG9wdHMubmFtZSlcbiAgfVxuXG4gIGZ1bmN0aW9uIF9vbkNsaWNrVHdpdHRlciAoZXZlbnQpIHtcbiAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpXG4gICAgdmFyIGxpbmsgPSBfYnVpbGRUd2l0dGVyTGluaygpXG4gICAgX3BvcHVwV2luZG93KGxpbmssICdUd2l0dGVyJywgNTgwLCA0NzApXG4gICAgX3RyYWNrKCdjbGljaycsICd0d2l0dGVyJywgb3B0cy5uYW1lKVxuICB9XG5cbiAgZnVuY3Rpb24gX29uQ2xpY2tGYWNlYm9vayAoZXZlbnQpIHtcbiAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpXG4gICAgdmFyIGxpbmsgPSBfYnVpbGRGYWNlYm9va0xpbmsoKVxuICAgIF9wb3B1cFdpbmRvdyhsaW5rLCAnRmFjZWJvb2snLCA1ODAsIDQ3MClcbiAgICBfdHJhY2soJ2NsaWNrJywgJ2ZhY2Vib29rJywgb3B0cy5uYW1lKVxuICB9XG5cbiAgZnVuY3Rpb24gX29uQ2xpY2tHaXRIdWIgKGV2ZW50KSB7XG4gICAgX3RyYWNrKCdjbGljaycsICdnaXRodWInLCBvcHRzLm5hbWUpXG4gIH1cblxuICAvLyBDbGlja2luZyBpbmZvIGJ1dHRvbiBzaG91bGQgbGVhZCB0byBwb3AgdXAgZGVzY3JpcHRpb24gdG8gb3BlbiB1cFxuICAvLyBDbGlja2luZyBpbmZvIGJ1dHRvbiBhZ2FpbiBzaG91bGQgbGVhZCB0byBkZXNjcmlwdGlvbiBib3ggY2xvc2luZ1xuICAvLyBJZiBubyBkZXNjcmlwdGlvbiBwcm92aWRlZCwgZG8gbm90IG9wZW4gZGVzY3JpcHRpb24gYm94XG4gIGZ1bmN0aW9uIF9vbkNsaWNrSW5mbyhldmVudCkge1xuICAgIHZhciBlbGVtID0gaW5mb0Rlc2NyaXB0aW9uRWxcbiAgICBpZiAoZWxlbS5zdHlsZS5kaXNwbGF5ID09PSAnYmxvY2snKSB7XG4gICAgICBlbGVtLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSdcbiAgICB9IGVsc2Uge1xuICAgICAgZWxlbS5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJ1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIF9idWlsZERlc2NyaXB0aW9uKGlkLCBjb250YWluZXIpIHtcbiAgICB2YXIgaW5mb0JveCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpXG4gICAgaW5mb0JveC5jbGFzc05hbWUgPSBcIm16LWJ1Zy1cIiArIGlkXG4gICAgaW5mb0JveC50ZXh0Q29udGVudCA9IG9wdHMuZGVzY3JpcHRpb24gXG4gICAgaW5mb0JveC5zdHlsZS53aWR0aCA9IGNvbnRhaW5lci5vZmZzZXRXaWR0aCArICdweCdcbiAgICBpbmZvQm94LnN0eWxlLm1hcmdpbkxlZnQgPSBjb250YWluZXIuc3R5bGUubWFyZ2luTGVmdFxuXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChpbmZvQm94KVxuICAgIHJldHVybiBpbmZvQm94XG4gIH1cblxuICBmdW5jdGlvbiByZXNpemVEZXNjcmlwdGlvbihjb250YWluZXIpIHtcbiAgICB2YXIgY29udGFpbmVyV2lkdGggPSBjb250YWluZXIub2Zmc2V0V2lkdGggXG4gICAgaW5mb0Rlc2NyaXB0aW9uRWwuc3R5bGUud2lkdGggPSBjb250YWluZXJXaWR0aCArICdweCdcbiAgICBpbmZvRGVzY3JpcHRpb25FbC5zdHlsZS5tYXJnaW5MZWZ0ID0gY29udGFpbmVyLnN0eWxlLm1hcmdpbkxlZnRcbiAgfVxuXG4gIGZ1bmN0aW9uIGNlbnRlclNjYXJhYihjb250YWluZXIpIHtcbiAgICB2YXIgY29udGFpbmVyV2lkdGggPSBjb250YWluZXIub2Zmc2V0V2lkdGhcbiAgICB2YXIgb2Zmc2V0TWFyZ2luID0gLTEgKiBjb250YWluZXJXaWR0aCAvIDJcbiAgICBjb250YWluZXIuc3R5bGUubWFyZ2luTGVmdCA9IG9mZnNldE1hcmdpbiArICdweCdcbiAgfVxuXG4gIHZhciBNYXB6ZW5TY2FyYWIgPSBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgIC8vIG5pZnR5IEpTIGNvbnN0cnVjdG9yIHBhdHRlcm4gdmlhIGJyb3dzZXJpZnkgZG9jdW1lbnRhdGlvblxuICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9zdWJzdGFjay9icm93c2VyaWZ5LWhhbmRib29rI3JldXNhYmxlLWNvbXBvbmVudHNcbiAgICBpZiAoISh0aGlzIGluc3RhbmNlb2YgTWFwemVuU2NhcmFiKSkgcmV0dXJuIG5ldyBNYXB6ZW5TY2FyYWIob3B0aW9ucylcblxuICAgIC8vIElmIGlmcmFtZWQsIGV4aXQgJiBkbyBub3RoaW5nLlxuICAgIGlmICh3aW5kb3cuc2VsZiAhPT0gd2luZG93LnRvcCkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgdGhpcy5zZXRPcHRpb25zKG9wdGlvbnMpXG5cbiAgICB0aGlzLmVsID0gX2NyZWF0ZUVsc0FuZEFwcGVuZCgpXG4gICAgdGhpcy50d2l0dGVyRWwgPSB0aGlzLmVsLnF1ZXJ5U2VsZWN0b3IoJy5tei1idWctdHdpdHRlci1saW5rJylcbiAgICB0aGlzLmZhY2Vib29rRWwgPSB0aGlzLmVsLnF1ZXJ5U2VsZWN0b3IoJy5tei1idWctZmFjZWJvb2stbGluaycpXG5cbiAgICBjZW50ZXJTY2FyYWIodGhpcy5lbCk7XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICBjZW50ZXJTY2FyYWIodGhpcy5lbClcbiAgICB9LmJpbmQodGhpcykpXG5cbiAgICAvLyBCdWlsZCBsaW5rc1xuICAgIHRoaXMucmVidWlsZExpbmtzKClcbiAgICAvLyBSZWJ1aWxkIGxpbmtzIGlmIGhhc2ggY2hhbmdlc1xuICAgIHdpbmRvdy5vbmhhc2hjaGFuZ2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgICB0aGlzLnJlYnVpbGRMaW5rcygpXG4gICAgfS5iaW5kKHRoaXMpXG5cbiAgICBpZiAob3B0cy5kZXNjcmlwdGlvbikge1xuICAgICAgaW5mb0Rlc2NyaXB0aW9uRWwgPSBfYnVpbGREZXNjcmlwdGlvbignZGVzY3JpcHRpb24nLCB0aGlzLmVsKVxuICAgICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIHJlc2l6ZURlc2NyaXB0aW9uKHRoaXMuZWwpXG4gICAgICB9LmJpbmQodGhpcykpXG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgaWYgR29vZ2xlIEFuYWx5dGljcyBpcyBwcmVzZW50IHNvb24gaW4gdGhlIGZ1dHVyZTsgaWYgbm90LCBsb2FkIGl0LlxuICAgIHdpbmRvdy5zZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmICh0eXBlb2YgZ2EgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIF9sb2FkQW5hbHl0aWNzKClcbiAgICAgICAgX3RyYWNrKCdhbmFseXRpY3MnLCAnZmFsbGJhY2snLCBudWxsLCB0cnVlKVxuICAgICAgfVxuXG4gICAgICBfdHJhY2soJ2J1ZycsICdhY3RpdmUnLCBvcHRzLm5hbWUsIHRydWUpXG4gICAgfSwgMClcbiAgfVxuXG4gIE1hcHplblNjYXJhYi5wcm90b3R5cGUucmVidWlsZExpbmtzID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMudHdpdHRlckVsLmhyZWYgPSBfYnVpbGRUd2l0dGVyTGluaygpXG4gICAgdGhpcy5mYWNlYm9va0VsLmhyZWYgPSBfYnVpbGRGYWNlYm9va0xpbmsoKVxuICB9XG5cbiAgTWFwemVuU2NhcmFiLnByb3RvdHlwZS5oaWRlID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuZWwuc3R5bGUuZGlzcGxheSA9ICdub25lJ1xuICB9XG5cbiAgTWFwemVuU2NhcmFiLnByb3RvdHlwZS5zaG93ID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuZWwuc3R5bGUuZGlzcGxheSA9ICdibG9jaydcbiAgfVxuXG4gIE1hcHplblNjYXJhYi5wcm90b3R5cGUuc2V0T3B0aW9ucyA9IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgLy8gRGVmYXVsdCBvcHRpb25zXG4gICAgb3B0cyA9IG9wdHMgfHwge1xuICAgICAgYW5hbHl0aWNzOiB0cnVlLFxuICAgICAgbmFtZTogbnVsbFxuICAgIH1cblxuICAgIC8vIENvcHkgb3B0aW9ucyB2YWx1ZXNcbiAgICBpZiAodHlwZW9mIG9wdGlvbnMgPT09ICdvYmplY3QnKSB7XG4gICAgICBmb3IgKHZhciBpIGluIG9wdGlvbnMpIHtcbiAgICAgICAgb3B0c1tpXSA9IG9wdGlvbnNbaV1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLm9wdHMgPSBvcHRzXG4gIH1cblxuICByZXR1cm4gTWFwemVuU2NhcmFiXG59KCkpXG5cbi8vIEV4cG9ydCBhcyBicm93c2VyaWZ5IG1vZHVsZSBpZiBwcmVzZW50LCBvdGhlcndpc2UsIGl0IGlzIGdsb2JhbCB0byB3aW5kb3dcbmlmICh0eXBlb2YgbW9kdWxlID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgbW9kdWxlLmV4cG9ydHMgPT09ICdvYmplY3QnKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gTWFwemVuU2NhcmFiXG59IGVsc2Uge1xuICB3aW5kb3cuTWFwemVuU2NhcmFiID0gTWFwemVuU2NhcmFiXG59XG4iLCIvLyAoYykgMjAxNSBNYXB6ZW5cbi8vXG4vLyBNQVAgVUkgwrcgR0VPTE9DQVRPUiB2MlxuLy9cbi8vIFwiTG9jYXRlIG1lXCIgYnV0dG9uIGZvciBkZW1vc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIGluaXQ6IGZ1bmN0aW9uIChvcHRpb25zLCBtYXApIHtcbiAgICAvKiBnbG9iYWwgbWFwICovXG4gICAgJ3VzZSBzdHJpY3QnXG5cbiAgICAvLyBIYW5kbGUgYG9wdGlvbnNgIHBhcmFtZXRlclxuICAgIC8vIElmIGBvcHRpb25zYCBpcyB1bmRlZmluZWQsIG1ha2UgaXQgYW4gZW1wdHkgb2JqZWN0XG4gICAgLy8gSWYgYG9wdGlvbnNgIGlzIGJvb2xlYW4sIHNldCBvcHRpb25zLnNob3cgcHJvcGVydHlcbiAgICAvLyBUaGlzIGFsbG93cyBmb3IgZnV0dXJlIHN5bnRheCB3aGVyZSBvcHRpb25zIGlzIGFuIG9iamVjdFxuICAgIGlmIChvcHRpb25zID09PSB0cnVlKSB7XG4gICAgICBvcHRpb25zID0ge1xuICAgICAgICBzaG93OiB0cnVlXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChvcHRpb25zID09PSBmYWxzZSkge1xuICAgICAgb3B0aW9ucyA9IHtcbiAgICAgICAgc2hvdzogZmFsc2VcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBvcHRpb25zID09PSAndW5kZWZpbmVkJykge1xuICAgICAgb3B0aW9ucyA9IHt9XG4gICAgfVxuXG4gICAgLy8gRXhpdCBpZiBkZW1vIGlzIGlmcmFtZWQgJiBub3QgZm9yY2VkIHRvIGJlIHR1cm5lZCBvblxuICAgIGlmICh3aW5kb3cuc2VsZiAhPT0gd2luZG93LnRvcCAmJiBvcHRpb25zLnNob3cgIT09IHRydWUpIHJldHVybiBmYWxzZVxuXG4gICAgLy8gRXhpdCBpZiBmb3JjZWQgdG8gYmUgdHVybmVkIG9mZlxuICAgIGlmIChvcHRpb25zLnNob3cgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcblxuICAgIHJlcXVpcmUoJ2xlYWZsZXQubG9jYXRlY29udHJvbCcpXG5cbiAgICAvLyBHZW9sb2NhdG9yXG4gICAgdmFyIGxvY2F0b3IgPSBMLmNvbnRyb2wubG9jYXRlKHtcbiAgICAgIGRyYXdDaXJjbGU6IGZhbHNlLFxuICAgICAgZm9sbG93OiBmYWxzZSxcbiAgICAgIHNob3dQb3B1cDogZmFsc2UsXG4gICAgICBkcmF3TWFya2VyOiBmYWxzZSxcbiAgICAgIG1hcmtlclN0eWxlOiB7XG4gICAgICAgIG9wYWNpdHk6IDAsXG4gICAgICB9LFxuICAgICAgc3RyaW5nczoge1xuICAgICAgICB0aXRsZTogJ0dldCBjdXJyZW50IGxvY2F0aW9uJ1xuICAgICAgfSxcbiAgICAgIGljb246ICdtei1nZW9sb2NhdG9yLWljb24nLFxuICAgICAgLy8gV2UgcGlnZ3kgYmFjayBvbiBnZW9jb2RlciBwbHVnaW4gc3R5bGVzIGFuZCB1c2UgdGhlaXIgbG9hZCBpY29uIHNvIGl0IGlzIHRoZSBzYW1lLlxuICAgICAgLy8gUmUtdXNpbmcgdGhlIGNsYXNzIG5hbWUgbWVhbnMgd2UgZG9uJ3QgZHVwbGljYXRlIHRoZSBlbWJlZGRlZCBpbWFnZSBzdHlsZSBpbiB0aGUgY29tcGlsZWQgYnVuZGxlLlxuICAgICAgaWNvbkxvYWRpbmc6ICdtei1nZW9sb2NhdG9yLWljb24gbXotZ2VvbG9jYXRvci1hY3RpdmUgbGVhZmxldC1wZWxpYXMtc2VhcmNoLWljb24gbGVhZmxldC1wZWxpYXMtbG9hZGluZydcbiAgICB9KS5hZGRUbyhtYXApXG5cbiAgICAvLyBSZS1zb3J0IGNvbnRyb2wgb3JkZXIgc28gdGhhdCBsb2NhdG9yIGlzIG9uIHRvcFxuICAgIC8vIGxvY2F0b3IuX2NvbnRhaW5lciBpcyBhIHJlZmVyZW5jZSB0byB0aGUgbG9jYXRvcidzIERPTSBlbGVtZW50LlxuICAgIGxvY2F0b3IuX2NvbnRhaW5lci5wYXJlbnROb2RlLmluc2VydEJlZm9yZShsb2NhdG9yLl9jb250YWluZXIsIGxvY2F0b3IuX2NvbnRhaW5lci5wYXJlbnROb2RlLmNoaWxkTm9kZXNbMF0pXG4gIH1cbn1cbiIsIi8vIChjKSAyMDE1IE1hcHplblxuLy9cbi8vIE1BUCBVSSDCtyBNQVBaRU4gU0VBUkNIXG4vL1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIGluaXQ6IGZ1bmN0aW9uIChvcHRpb25zLCBtYXApIHtcbiAgICAvKiBnbG9iYWwgbWFwICovXG4gICAgJ3VzZSBzdHJpY3QnXG5cbiAgICAvLyBIYW5kbGUgYG9wdGlvbnNgIHBhcmFtZXRlclxuICAgIC8vIElmIGBvcHRpb25zYCBpcyB1bmRlZmluZWQsIG1ha2UgaXQgYW4gZW1wdHkgb2JqZWN0XG4gICAgLy8gSWYgYG9wdGlvbnNgIGlzIGJvb2xlYW4sIHNldCBvcHRpb25zLnNob3cgcHJvcGVydHlcbiAgICAvLyBUaGlzIGFsbG93cyBmb3IgZnV0dXJlIHN5bnRheCB3aGVyZSBvcHRpb25zIGlzIGFuIG9iamVjdFxuICAgIGlmIChvcHRpb25zID09PSB0cnVlKSB7XG4gICAgICBvcHRpb25zID0ge1xuICAgICAgICBzaG93OiB0cnVlXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChvcHRpb25zID09PSBmYWxzZSkge1xuICAgICAgb3B0aW9ucyA9IHtcbiAgICAgICAgc2hvdzogZmFsc2VcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBvcHRpb25zID09PSAndW5kZWZpbmVkJykge1xuICAgICAgb3B0aW9ucyA9IHt9XG4gICAgfVxuXG4gICAgLy8gRXhpdCBpZiBkZW1vIGlzIGlmcmFtZWQgJiBub3QgZm9yY2VkIHRvIGJlIHR1cm5lZCBvblxuICAgIGlmICh3aW5kb3cuc2VsZiAhPT0gd2luZG93LnRvcCAmJiBvcHRpb25zLnNob3cgIT09IHRydWUpIHJldHVybiBmYWxzZVxuXG4gICAgLy8gRXhpdCBpZiBmb3JjZWQgdG8gYmUgdHVybmVkIG9mZlxuICAgIGlmIChvcHRpb25zLnNob3cgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcblxuICAgIHJlcXVpcmUoJ2xlYWZsZXQtZ2VvY29kZXItbWFwemVuJylcblxuICAgIHZhciBERU1PX0FQSV9LRVkgPSAnc2VhcmNoLVBGWjhpRngnXG5cbiAgICB2YXIgZ2VvY29kZXJPcHRpb25zID0ge1xuICAgICAgZXhwYW5kZWQ6IHRydWUsXG4gICAgICBsYXllcnM6IFsnY29hcnNlJ10sXG4gICAgICBwbGFjZWhvbGRlcjogJ1NlYXJjaCBmb3IgY2l0eScsXG4gICAgICB0aXRsZTogJ1NlYXJjaCBmb3IgY2l0eScsXG4gICAgICBwb2ludEljb246IGZhbHNlLFxuICAgICAgcG9seWdvbkljb246IGZhbHNlLFxuICAgICAgbWFya2VyczogZmFsc2UsXG4gICAgICBwYXJhbXM6IHtcbiAgICAgICAgLy8gVE9ETzogcmVtb3ZlIGdlb25hbWVzIGFmdGVyIFdPRiBpbmNvcnBvcmF0ZXMgY2l0aWVzICYgUGVsaWFzIGluY2x1ZGVzIGFsdC1uYW1lIHNlYXJjaFxuICAgICAgICBzb3VyY2VzOiAnd29mLGduJ1xuICAgICAgfVxuICAgIH1cblxuICAgIHZhciBnZW9jb2RlciA9IEwuY29udHJvbC5nZW9jb2RlcihERU1PX0FQSV9LRVksIGdlb2NvZGVyT3B0aW9ucykuYWRkVG8obWFwKVxuXG4gICAgLy8gUmUtc29ydCBjb250cm9sIG9yZGVyIHNvIHRoYXQgZ2VvY29kZXIgaXMgb24gdG9wXG4gICAgLy8gZ2VvY29kZXIuX2NvbnRhaW5lciBpcyBhIHJlZmVyZW5jZSB0byB0aGUgZ2VvY29kZXIncyBET00gZWxlbWVudC5cbiAgICBnZW9jb2Rlci5fY29udGFpbmVyLnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKGdlb2NvZGVyLl9jb250YWluZXIsIGdlb2NvZGVyLl9jb250YWluZXIucGFyZW50Tm9kZS5jaGlsZE5vZGVzWzBdKVxuXG4gICAgLy8gSGFuZGxlIHdoZW4gdmlld3BvcnQgaXMgc21hbGxlclxuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdyZXNpemUnLCBjaGVja1Jlc2l6ZSlcbiAgICBjaGVja1Jlc2l6ZSgpIC8vIENoZWNrIG9uIGxvYWRcblxuICAgIHZhciBpc0xpc3RlbmluZyA9IGZhbHNlXG4gICAgdmFyIHByZXZpb3VzV2lkdGggPSBnZXRWaWV3cG9ydFdpZHRoKClcblxuICAgIGZ1bmN0aW9uIGdldFZpZXdwb3J0V2lkdGggKCkge1xuICAgICAgcmV0dXJuIHdpbmRvdy5pbm5lcldpZHRoID8gd2luZG93LmlubmVyV2lkdGggOiBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuY2xpZW50V2lkdGggPyBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuY2xpZW50V2lkdGggOiB3aW5kb3cuc2NyZWVuLndpZHRoXG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2hlY2tSZXNpemUgKGV2ZW50KSB7XG4gICAgICB2YXIgd2lkdGggPSBnZXRWaWV3cG9ydFdpZHRoKClcblxuICAgICAgLy8gZG9uJ3QgZG8gYW55dGhpbmcgaWYgdGhlIFdJRFRIIGhhcyBub3QgY2hhbmdlZC5cbiAgICAgIGlmICh3aWR0aCA9PT0gcHJldmlvdXNXaWR0aCkgcmV0dXJuXG5cbiAgICAgIGlmICh3aWR0aCA8IDkwMCkge1xuICAgICAgICAvLyBEbyB0aGVzZSBjaGVja3MgdG8gbWFrZSBzdXJlIGNvbGxhcHNlIC8gZXhwYW5kIGV2ZW50cyBkb24ndCBmaXJlIGNvbnRpbnVvdXNseVxuICAgICAgICBpZiAoTC5Eb21VdGlsLmhhc0NsYXNzKGdlb2NvZGVyLl9jb250YWluZXIsICdsZWFmbGV0LXBlbGlhcy1leHBhbmRlZCcpKSB7XG4gICAgICAgICAgZ2VvY29kZXIuY29sbGFwc2UoKVxuICAgICAgICAgIG1hcC5vZmYoJ21vdXNlZG93bicsIGdlb2NvZGVyLmNvbGxhcHNlLmJpbmQoZ2VvY29kZXIpKVxuICAgICAgICAgIGlzTGlzdGVuaW5nID0gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKCFMLkRvbVV0aWwuaGFzQ2xhc3MoZ2VvY29kZXIuX2NvbnRhaW5lciwgJ2xlYWZsZXQtcGVsaWFzLWV4cGFuZGVkJykpIHtcbiAgICAgICAgICBnZW9jb2Rlci5leHBhbmQoKVxuICAgICAgICAgIC8vIE1ha2Ugc3VyZSBvbmx5IG9uZSBvZiB0aGVzZSBhcmUgbGlzdGVuaW5nXG4gICAgICAgICAgaWYgKGlzTGlzdGVuaW5nID09PSBmYWxzZSkge1xuICAgICAgICAgICAgbWFwLm9uKCdtb3VzZWRvd24nLCBnZW9jb2Rlci5jb2xsYXBzZS5iaW5kKGdlb2NvZGVyKSlcbiAgICAgICAgICAgIGlzTGlzdGVuaW5nID0gdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBwcmV2aW91c1dpZHRoID0gd2lkdGhcbiAgICB9XG5cbiAgICBnZW9jb2Rlci5vbignZXhwYW5kJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICBpZiAoaXNMaXN0ZW5pbmcgPT09IGZhbHNlKSB7XG4gICAgICAgIG1hcC5vbignbW91c2Vkb3duJywgZ2VvY29kZXIuY29sbGFwc2UuYmluZChnZW9jb2RlcikpXG4gICAgICAgIGlzTGlzdGVuaW5nID0gdHJ1ZVxuICAgICAgfVxuICAgIH0pXG4gIH1cbn1cbiIsIi8vIChjKSAyMDE1IE1hcHplblxuLy9cbi8vIFVUSUxTIMK3IElGUkFNRUQgQU5DSE9SIFRBUkdFVFNcbi8vXG4vLyBCb3R0b20gbGluZSBpcywgZG9u4oCZdCB1c2UgdGFyZ2V0PVwiX2JsYW5rXCIgaW4gYW5jaG9ycy5cbi8vIFJlYWQgbW9yZTogaHR0cHM6Ly9jc3MtdHJpY2tzLmNvbS91c2UtdGFyZ2V0X2JsYW5rL1xuLy9cbi8vIElmIHlvdeKAmXJlIGluIGFuIGlmcmFtZSwgdGhvdWdoLCB5b3UgbWF5IG5vdCB3YW50IGxpbmtzIHRvIG9wZW4gd2l0aGluIHRoZVxuLy8gZnJhbWUuIFRoZSBmb2xsb3dpbmcgY29kZSBzbmlwcGV0IHdpbGwgYWRkIHRhcmdldD1cIl90b3BcIiB0byBhbGwgbGlua3MgdGhhdFxuLy8gZG8gbm90IGhhdmUgYW4gZXhwbGljaXQgdGFyZ2V0IGF0dHJpYnV0ZS4gWW91IG1heSBmb3JjZSB0YXJnZXQ9XCJfYmxhbmtcIiB0b1xuLy8gYmUgdGFyZ2V0PVwiX3RvcFwiIGJ5IHBhc3NpbmcgYW4gb3B0aW9uYWwgcGFyYW1ldGVyIG9mIFwidHJ1ZVwiLlxuLy9cbi8vIFJlY29tbWVuZGVkIHVzZTogcnVuIHRoaXMgZnVuY3Rpb24gaW4gYSBjaGVjayBmb3IgaWZyYW1lZCBzdGF0dXMsIGUuZy5cbi8vICAgICBpZiAod2luZG93LnNlbGYgIT09IHdpbmRvdy50b3ApIGFuY2hvclRhcmdldHModHJ1ZSlcbi8vXG4vLyBJZiB0aGlzIGlzIGJlaW5nIHJ1biB3aXRoIExlYWZsZXQsIHJ1biB0aGlzIGFmdGVyIHRoZSBtYXAgaXMgaW5pdGlhbGl6ZWRcbi8vIHRvIG1ha2Ugc3VyZSBhbGwgYXR0cmlidXRpb24gbGlua3Mgb3BlbiBpbiB0aGUgcGFyZW50IHRhYiAvIHdpbmRvdy5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGZvcmNlKSB7XG4gICd1c2Ugc3RyaWN0J1xuXG4gIHZhciBhbmNob3JzID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnYScpXG5cbiAgZm9yICh2YXIgaSA9IDAsIGogPSBhbmNob3JzLmxlbmd0aDsgaSA8IGo7IGkrKykge1xuICAgIHZhciBlbCA9IGFuY2hvcnNbaV1cblxuICAgIC8vIE9ubHkgc2V0IHRhcmdldCB3aGVuIG5vdCBleHBsaWNpdGx5IHNwZWNpZmllZFxuICAgIC8vIHRvIGF2b2lkIG92ZXJ3cml0aW5nIGludGVudGlvbmFsIHRhcmdldGluZyBiZWhhdmlvclxuICAgIC8vIFVubGVzcyB0aGUgZm9yY2UgcGFyYW1ldGVyIGlzIHRydWUsIHRoZW4gdGFyZ2V0cyBvZlxuICAgIC8vICdfYmxhbmsnIGFyZSBmb3JjZWQgdG8gdG8gYmUgJ190b3AnXG4gICAgaWYgKCFlbC50YXJnZXQgfHwgKGZvcmNlID09PSB0cnVlICYmIGVsLnRhcmdldCA9PT0gJ19ibGFuaycpKSB7XG4gICAgICBlbC50YXJnZXQgPSAnX3RvcCdcbiAgICB9XG4gIH1cbn1cbiIsIi8vIChjKSAyMDE1IE1hcHplblxuLy9cbi8vIE1BUCBVSSDCtyBDT05ESVRJT05BTExZIERJU1BMQVlFRCBaT09NIEJVVFRPTlNcbi8vXG4vLyAgICAgICAgICAgICAgICAgICAgIMK3IEEgUE9FTSDCt1xuLy9cbi8vIFdoZXJlIHRoZXJlIGlzIGEgbWFwLFxuLy8gT24gdG91Y2gtZW5hYmxlZCBkZXZpY2VzXG4vL1xuLy8gVGhlIHpvb20gY29udHJvbHMgYXJlIHVubmVjZXNzYXJ5IC1cbi8vICAgICAgICAgICAgICAgIFRoZXkgY2x1dHRlciB0aGUgVUkuXG4vL1xuLy8gVGhlcmVmb3JlLFxuLy8gVGhleSBzaG91bGQgYmUgZGlzYWJsZWQuXG4vL1xuLy8gICAgICAgICAgICAgICAgICAgICDCtyAgRklOICDCt1xuLy9cbi8vIEFkZGl0aW9uYWwgbm90ZXM6XG4vLyAgLSBXZSBkb27igJl0IG5lZWQgdG8gY2FyZSB3aGV0aGVyIHpvb20gaXMgZW5hYmxlZCBvciBub3Qgb24gdGhlIG1hcC5cbi8vICAtIEl0IGRvZXNu4oCZdCBtYXR0ZXIgd2hhdCB0aGUgdmlld3BvcnQgLyBkZXZpY2UgZGltZW5zaW9ucyBhcmUuXG4vLyAgLSBUb3VjaCBkZXRlY3Rpb24gaXMgZmxha3kuIFNlZSB0aGlzIGRpc2N1c3Npb246XG4vLyAgICBodHRwOi8vd3d3LnN0dWNveC5jb20vYmxvZy95b3UtY2FudC1kZXRlY3QtYS10b3VjaHNjcmVlbi9cbi8vICAgIFRoYXQgc2FpZCwgd2XigJlsbCBhdHRlbXB0IHRvIGNhcHR1cmUgbW9yZSBmcmVxdWVudFxuLy8gICAgdXNlIGNhc2VzIGFuZCBsZWF2ZSB6b29tIGJ1dHRvbnMgaW4gcGxhY2Ugb3RoZXJ3aXNlLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLyogZ2xvYmFsIE1vZGVybml6ciwgbWFwICovXG5cbnZhciBERUJVRyA9IHRydWVcblxuZnVuY3Rpb24gZGVidWcgKG1lc3NhZ2UpIHtcbiAgaWYgKERFQlVHID09PSB0cnVlKSB7XG4gICAgY29uc29sZS5sb2coJ01QWk4gWm9vbUNvbnRyb2w6ICcgKyBtZXNzYWdlKVxuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkge1xuICAndXNlIHN0cmljdCdcblxuICAvLyBBc3N1bWVzIGEgZ2xvYmFsIGBtYXBgIG9iamVjdFxuICAvLyBUT0RPOiBBc2sgZm9yIG9iamVjdCBleHBsaWNpdGx5XG4gIHZhciBtYXBSZWYgPSBtYXAgfHwgbnVsbFxuICB2YXIgaXNQcm9iYWJseVRvdWNoc2NyZWVuXG5cbiAgZGVidWcoJ0NvbmRpdGlvbmFsIHpvb20gY29udHJvbCBhY3RpdmUuJylcblxuICAvLyBBcmUgd2UgaW4gYSB0b3VjaC1zY3JlZW4gZW52aXJvbm1lbnQ/XG4gIC8vIENoZWNrIGlmIE1vZGVybml6ciBpcyBwcmVzZW50IGFuZCBkZXRlY3RpbmcgdG91Y2hcbiAgLy8gTW9kZXJuaXpyIG1pZ2h0IGJlIHByZXNlbnQsIGJ1dCBub3QgcGVyZm9ybWluZyBhIHRvdWNoIHRlc3QsIHNvIGRvIG91ciBvd24gc25pZmYgdGVzdCBhbHNvXG4gIC8vIFRPRE86IFJlcXVpcmUgTW9kZXJuaXpyP1xuICBpZiAoKHR5cGVvZiBNb2Rlcm5penIgPT09ICdvYmplY3QnICYmIE1vZGVybml6ci5oYXNPd25Qcm9wZXJ0eSgndG91Y2gnKSAmJiBNb2Rlcm5penIudG91Y2ggPT09IHRydWUpIHx8ICdvbnRvdWNoc3RhcnQnIGluIHdpbmRvdykge1xuICAgIGlzUHJvYmFibHlUb3VjaHNjcmVlbiA9IHRydWVcbiAgfVxuXG4gIC8vIE92ZXJyaWRlcyB0aGUgem9vbSBjb250YWluZXIgZWxlbWVudCBkaXNwbGF5IHN0eWxlXG4gIC8vIFRPRE86IFByb3ZpZGUgZnVuY3Rpb25hbGl0eSBmb3Igb3RoZXIgbWFwIGxpYnJhcmllc1xuICBpZiAoaXNQcm9iYWJseVRvdWNoc2NyZWVuID09PSB0cnVlKSB7XG4gICAgZGVidWcoJ1RvdWNoc2NyZWVuIGRldGVjdGVkLicpXG4gICAgLy8gRG91YmxlIGNoZWNrIHRoYXQgaXQgaXMgTGVhZmxldFxuICAgIGlmICh0eXBlb2YgbWFwUmVmID09PSAnb2JqZWN0JyAmJiBtYXBSZWYuaGFzT3duUHJvcGVydHkoJ19sZWFmbGV0X2lkJykpIHtcbiAgICAgIGRlYnVnKCdMZWFmbGV0IGRldGVjdGVkLCBoaWRpbmcgem9vbSBjb250cm9sLicpXG4gICAgICBtYXBSZWYuem9vbUNvbnRyb2wuX2NvbnRhaW5lci5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGRlYnVnKCdObyB0b3VjaHNjcmVlbiBkZXRlY3RlZCwgZXhpdGluZy4nKVxuICB9XG59XG4iLCIvLyAoYykgMjAxNS0yMDE2IE1hcHplblxuLy9cbi8vIE1BUFpFTiBVSSBCVU5ETEVcbi8vXG4vLyBSZXF1aXJlcyBldmVyeXRoaW5nIHZpYSBicm93c2VyaWZ5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vKiBnbG9iYWwgcmVxdWlyZSwgbW9kdWxlICovXG4ndXNlIHN0cmljdCdcblxudmFyIEJ1ZyA9IHJlcXVpcmUoJ21hcHplbi1zY2FyYWInKVxudmFyIHNlYXJjaCA9IHJlcXVpcmUoJy4vY29tcG9uZW50cy9zZWFyY2gvc2VhcmNoJylcbnZhciBnZW9sb2NhdG9yID0gcmVxdWlyZSgnLi9jb21wb25lbnRzL2dlb2xvY2F0b3IvZ2VvbG9jYXRvcicpXG52YXIgem9vbUNvbnRyb2wgPSByZXF1aXJlKCcuL2NvbXBvbmVudHMvdXRpbHMvem9vbS1jb250cm9sJylcbnZhciBhbmNob3JUYXJnZXRzID0gcmVxdWlyZSgnLi9jb21wb25lbnRzL3V0aWxzL2FuY2hvci10YXJnZXRzJylcblxuLy8gVG8gYXZvaWQgbWFraW5nIGFuIGV4dGVybmFsIHJlcXVlc3QgZm9yIHN0eWxlcyAod2hpY2ggcmVzdWx0cyBpbiBhbiB1Z2x5XG4vLyBGbGFzaCBvZiBVbnN0eWxlZCBDb250ZW50KSB3ZSdyZSBnb2luZyB0byBpbmxpbmUgYWxsIHRoZSBzdHlsZXMgaW50b1xuLy8gdGhpcyBKUyBmaWxlLiBUaGlzIGlzIGRvbmUgYnkgdGFraW5nIHRoZSBtaW5pZmllZCwgY29uY2F0ZW5hdGVkIENTUyBhbmRcbi8vIGluc2VydGluZyBpdCB2aWEgbXVzdGFjaGUgaW4gdGhpcyB2YXJpYWJsZSBoZXJlOlxudmFyIGNzcyA9ICd7e3sgY3NzVGV4dCB9fX0nXG5cbi8vIExvYWRzIHN0eWxlc2hlZXQgZm9yIHRoZSBidWcuXG4vLyBFbnN1cmVzIHRoYXQgaXQgaXMgcGxhY2VkIGJlZm9yZSBvdGhlciBkZWZpbmVkIHN0eWxlc2hlZXRzIG9yIHN0eWxlXG4vLyBibG9ja3MgaW4gdGhlIGhlYWQsIHNvIHRoYXQgY3VzdG9tIHN0eWxlcyBhcmUgYWxsb3dlZCB0byBvdmVycmlkZVxuZnVuY3Rpb24gaW5zZXJ0U3R5bGVzaGVldCAoY3NzVGV4dCkge1xuICB2YXIgZmlyc3RTdHlsZXNoZWV0ID0gZG9jdW1lbnQuaGVhZC5xdWVyeVNlbGVjdG9yQWxsKCdsaW5rLCBzdHlsZScpWzBdXG4gIHZhciBzdHlsZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3R5bGUnKVxuXG4gIHN0eWxlRWwudHlwZSA9ICd0ZXh0L2NzcydcblxuICBpZiAoc3R5bGVFbC5zdHlsZVNoZWV0KXtcbiAgICBzdHlsZUVsLnN0eWxlU2hlZXQuY3NzVGV4dCA9IGNzc1xuICB9IGVsc2Uge1xuICAgIHN0eWxlRWwuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoY3NzKSlcbiAgfVxuXG4gIGlmIChmaXJzdFN0eWxlc2hlZXQgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgZG9jdW1lbnQuaGVhZC5pbnNlcnRCZWZvcmUoc3R5bGVFbCwgZmlyc3RTdHlsZXNoZWV0KVxuICB9IGVsc2Uge1xuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQoc3R5bGVFbClcbiAgfVxufVxuXG5pbnNlcnRTdHlsZXNoZWV0KGNzcylcblxuLy8gRXhwb3J0XG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG4gIHZhciBNUFpOID0ge1xuICAgIC8vIFJlZmVyZW5jZSBmb3IgbGVnYWN5XG4gICAgY2l0eXNlYXJjaDogc2VhcmNoLFxuICAgIGdlb2xvY2F0b3I6IGdlb2xvY2F0b3IsXG4gICAgVXRpbHM6IHtcbiAgICAgIGFuY2hvclRhcmdldHM6IGFuY2hvclRhcmdldHMsXG4gICAgICB6b29tQ29udHJvbDogem9vbUNvbnRyb2wsXG4gICAgfVxuICB9XG5cbiAgTVBaTi5idWcgPSBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9XG4gICAgdmFyIGJ1ZyA9IEJ1ZyhvcHRpb25zKVxuXG4gICAgdmFyIGxlYWZsZXRNYXBcblxuICAgIC8vIFdoYXQgaXMgdGhlIGxlYWZsZXQgTWFwIG9iamVjdD8gWW91IGNhbiBwYXNzIGl0IGluIGFzIGFuIG9wdGlvbiwgb3IgbG9vayBmb3IgaXRcbiAgICAvLyBvbiB3aW5kb3cubWFwIGFuZCBzZWUgaWYgaXQgYSBMZWFmbGV0IGluc3RhbmNlXG4gICAgaWYgKG9wdGlvbnMubWFwKSB7XG4gICAgICBsZWFmbGV0TWFwID0gb3B0aW9ucy5tYXBcbiAgICB9IGVsc2UgaWYgKHdpbmRvdy5tYXAgJiYgd2luZG93Lm1hcC5fY29udGFpbmVyICYmIHdpbmRvdy5tYXAuX2NvbnRhaW5lciBpbnN0YW5jZW9mIEhUTUxFbGVtZW50KSB7XG4gICAgICBsZWFmbGV0TWFwID0gd2luZG93Lm1hcFxuICAgIH1cblxuICAgIC8vIGlmIGxlYWZsZXQsIG1vdmUgdGhlIGJ1ZyBlbGVtZW50IGludG8gaXRzIC5sZWFmbGV0LWNvbnRyb2wtY29udGFpbmVyXG4gICAgaWYgKGxlYWZsZXRNYXAgJiYgYnVnLmVsICYmIGJ1Zy5lbCBpbnN0YW5jZW9mIEhUTUxFbGVtZW50KSB7XG4gICAgICBsZWFmbGV0TWFwLl9jb250YWluZXIucXVlcnlTZWxlY3RvcignLmxlYWZsZXQtY29udHJvbC1jb250YWluZXInKS5hcHBlbmRDaGlsZChidWcuZWwpXG4gICAgfVxuXG4gICAgLy8gU29ydGVkIGJ5IHJldmVyc2Ugb3JkZXJcbiAgICBnZW9sb2NhdG9yLmluaXQob3B0aW9ucy5sb2NhdGUsIGxlYWZsZXRNYXApXG4gICAgc2VhcmNoLmluaXQob3B0aW9ucy5zZWFyY2gsIGxlYWZsZXRNYXApXG4gIH1cblxuICAvLyBEbyBzdHVmZlxuICBNUFpOLlV0aWxzLnpvb21Db250cm9sKClcblxuICAvLyBPbmx5IG9wZXJhdGUgaWYgaWZyYW1lZFxuICBpZiAod2luZG93LnNlbGYgIT09IHdpbmRvdy50b3ApIHtcbiAgICBNUFpOLlV0aWxzLmFuY2hvclRhcmdldHMoKVxuICB9XG5cbiAgLy8gRXhwb3NlIGZvciBleHRlcm5hbCBhY2Nlc3NcbiAgd2luZG93Lk1QWk4gPSBNUFpOXG5cbiAgcmV0dXJuIE1QWk5cbn0pKClcbiJdfQ==
