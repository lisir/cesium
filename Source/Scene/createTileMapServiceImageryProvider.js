/*global define*/
define([
        '../Core/Cartesian2',
        '../Core/Cartographic',
        '../Core/Credit',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/DeveloperError',
        '../Core/Event',
        '../Core/GeographicTilingScheme',
        '../Core/joinUrls',
        '../Core/loadXML',
        '../Core/Rectangle',
        '../Core/RequestScheduler',
        '../Core/RuntimeError',
        '../Core/TileProviderError',
        '../Core/WebMercatorTilingScheme',
        '../ThirdParty/when',
        './UrlTemplateImageryProvider'
    ], function(
        Cartesian2,
        Cartographic,
        Credit,
        defaultValue,
        defined,
        defineProperties,
        DeveloperError,
        Event,
        GeographicTilingScheme,
        joinUrls,
        loadXML,
        Rectangle,
        RequestScheduler,
        RuntimeError,
        TileProviderError,
        WebMercatorTilingScheme,
        when,
        UrlTemplateImageryProvider) {
    'use strict';

    /**
     * Creates a {@link UrlTemplateImageryProvider} instance that provides tiled imagery as generated by
     * {@link http://www.maptiler.org/'>MapTiler</a> / <a href='http://www.klokan.cz/projects/gdal2tiles/|GDDAL2Tiles} etc.
     *
     * @exports createTileMapServiceImageryProvider
     *
     * @param {Object} [options] Object with the following properties:
     * @param {String} [options.url='.'] Path to image tiles on server.
     * @param {String} [options.fileExtension='png'] The file extension for images on the server.
     * @param {Object} [options.proxy] A proxy to use for requests. This object is expected to have a getURL function which returns the proxied URL.
     * @param {Credit|String} [options.credit=''] A credit for the data source, which is displayed on the canvas.
     * @param {Number} [options.minimumLevel=0] The minimum level-of-detail supported by the imagery provider.  Take care when specifying
     *                 this that the number of tiles at the minimum level is small, such as four or less.  A larger number is likely
     *                 to result in rendering problems.
     * @param {Number} [options.maximumLevel] The maximum level-of-detail supported by the imagery provider, or undefined if there is no limit.
     * @param {Rectangle} [options.rectangle=Rectangle.MAX_VALUE] The rectangle, in radians, covered by the image.
     * @param {TilingScheme} [options.tilingScheme] The tiling scheme specifying how the ellipsoidal
     * surface is broken into tiles.  If this parameter is not provided, a {@link WebMercatorTilingScheme}
     * is used.
     * @param {Ellipsoid} [options.ellipsoid] The ellipsoid.  If the tilingScheme is specified,
     *                    this parameter is ignored and the tiling scheme's ellipsoid is used instead. If neither
     *                    parameter is specified, the WGS84 ellipsoid is used.
     * @param {Number} [options.tileWidth=256] Pixel width of image tiles.
     * @param {Number} [options.tileHeight=256] Pixel height of image tiles.
     * @param {Boolean} [options.flipXY] Older versions of gdal2tiles.py flipped X and Y values in tilemapresource.xml.
     * Specifying this option will do the same, allowing for loading of these incorrect tilesets.
     * @returns {UrlTemplateImageryProvider} The imagery provider.
     *
     * @see ArcGisMapServerImageryProvider
     * @see BingMapsImageryProvider
     * @see GoogleEarthImageryProvider
     * @see createOpenStreetMapImageryProvider
     * @see SingleTileImageryProvider
     * @see WebMapServiceImageryProvider
     * @see WebMapTileServiceImageryProvider
     * @see UrlTemplateImageryProvider
     *
     * @see {@link http://www.maptiler.org/|MapTiler}
     * @see {@link http://www.klokan.cz/projects/gdal2tiles/|GDDAL2Tiles}
     * @see {@link http://www.w3.org/TR/cors/|Cross-Origin Resource Sharing}
     *
     * @example
     * var tms = Cesium.createTileMapServiceImageryProvider({
     *    url : '../images/cesium_maptiler/Cesium_Logo_Color',
     *    fileExtension: 'png',
     *    maximumLevel: 4,
     *    rectangle: new Cesium.Rectangle(
     *        Cesium.Math.toRadians(-120.0),
     *        Cesium.Math.toRadians(20.0),
     *        Cesium.Math.toRadians(-60.0),
     *        Cesium.Math.toRadians(40.0))
     * });
     */
    function createTileMapServiceImageryProvider(options) {
        options = defaultValue(options, {});

        //>>includeStart('debug', pragmas.debug);
        if (!defined(options.url)) {
            throw new DeveloperError('options.url is required.');
        }
        //>>includeEnd('debug');

        var url = options.url;

        var deferred = when.defer();
        var imageryProvider = new UrlTemplateImageryProvider(deferred.promise);

        var metadataError;

        function metadataSuccess(xml) {
            var tileFormatRegex = /tileformat/i;
            var tileSetRegex = /tileset/i;
            var tileSetsRegex = /tilesets/i;
            var bboxRegex = /boundingbox/i;
            var srsRegex = /srs/i;
            var format, bbox, tilesets, srs;
            var tilesetsList = []; //list of TileSets

            // Allowing options properties (already copied to that) to override XML values

            // Iterate XML Document nodes for properties
            var nodeList = xml.childNodes[0].childNodes;
            for (var i = 0; i < nodeList.length; i++){
                if (tileFormatRegex.test(nodeList.item(i).nodeName)) {
                    format = nodeList.item(i);
                } else if (tileSetsRegex.test(nodeList.item(i).nodeName)) {
                    tilesets = nodeList.item(i); // Node list of TileSets
                    var tileSetNodes = nodeList.item(i).childNodes;
                    // Iterate the nodes to find all TileSets
                    for(var j = 0; j < tileSetNodes.length; j++) {
                        if (tileSetRegex.test(tileSetNodes.item(j).nodeName)) {
                            // Add them to tilesets list
                            tilesetsList.push(tileSetNodes.item(j));
                        }
                    }
                } else if (bboxRegex.test(nodeList.item(i).nodeName)) {
                    bbox = nodeList.item(i);
                } else if (srsRegex.test(nodeList.item(i).nodeName)) {
                    srs = nodeList.item(i).textContent;
                }
            }

            var fileExtension = defaultValue(options.fileExtension, format.getAttribute('extension'));
            var tileWidth = defaultValue(options.tileWidth, parseInt(format.getAttribute('width'), 10));
            var tileHeight = defaultValue(options.tileHeight, parseInt(format.getAttribute('height'), 10));
            var minimumLevel = defaultValue(options.minimumLevel, parseInt(tilesetsList[0].getAttribute('order'), 10));
            var maximumLevel = defaultValue(options.maximumLevel, parseInt(tilesetsList[tilesetsList.length - 1].getAttribute('order'), 10));
            var tilingSchemeName = tilesets.getAttribute('profile');
            var tilingScheme = options.tilingScheme;

            if (!defined(tilingScheme)) {
                if (tilingSchemeName === 'geodetic' || tilingSchemeName === 'global-geodetic') {
                    tilingScheme = new GeographicTilingScheme({ ellipsoid : options.ellipsoid });
                } else if (tilingSchemeName === 'mercator' || tilingSchemeName === 'global-mercator') {
                    tilingScheme = new WebMercatorTilingScheme({ ellipsoid : options.ellipsoid });
                } else {
                    var message = joinUrls(url, 'tilemapresource.xml') + 'specifies an unsupported profile attribute, ' + tilingSchemeName + '.';
                    metadataError = TileProviderError.handleError(metadataError, imageryProvider, imageryProvider.errorEvent, message, undefined, undefined, undefined, requestMetadata);
                    if(!metadataError.retry) {
                        deferred.reject(new RuntimeError(message));
                    }
                    return;
                }
            }

            // rectangle handling
            var rectangle = Rectangle.clone(options.rectangle);

            if (!defined(rectangle)) {
                var sw;
                var ne;
                var swXY;
                var neXY;

                // In older versions of gdal x and y values were flipped, which is why we check for an option to flip
                // the values here as well. Unfortunately there is no way to autodetect whether flipping is needed.
                var flipXY = defaultValue(options.flipXY, false);
                if (flipXY) {
                    swXY = new Cartesian2(parseFloat(bbox.getAttribute('miny')), parseFloat(bbox.getAttribute('minx')));
                    neXY = new Cartesian2(parseFloat(bbox.getAttribute('maxy')), parseFloat(bbox.getAttribute('maxx')));
                } else {
                    swXY = new Cartesian2(parseFloat(bbox.getAttribute('minx')), parseFloat(bbox.getAttribute('miny')));
                    neXY = new Cartesian2(parseFloat(bbox.getAttribute('maxx')), parseFloat(bbox.getAttribute('maxy')));
                }

                // Determine based on the profile attribute if this tileset was generated by gdal2tiles.py, which
                // uses 'mercator' and 'geodetic' profiles, or by a tool compliant with the TMS standard, which is
                // 'global-mercator' and 'global-geodetic' profiles. In the gdal2Tiles case, X and Y are always in
                // geodetic degrees.
                var isGdal2tiles = tilingSchemeName === 'geodetic' || tilingSchemeName === 'mercator';
                if (tilingScheme instanceof GeographicTilingScheme || isGdal2tiles) {
                    sw = Cartographic.fromDegrees(swXY.x, swXY.y);
                    ne = Cartographic.fromDegrees(neXY.x, neXY.y);
                } else {
                    var projection = tilingScheme.projection;
                    sw = projection.unproject(swXY);
                    ne = projection.unproject(neXY);
                }

                rectangle = new Rectangle(sw.longitude, sw.latitude, ne.longitude, ne.latitude);
            }

            // The rectangle must not be outside the bounds allowed by the tiling scheme.
            if (rectangle.west < tilingScheme.rectangle.west) {
                rectangle.west = tilingScheme.rectangle.west;
            }
            if (rectangle.east > tilingScheme.rectangle.east) {
                rectangle.east = tilingScheme.rectangle.east;
            }
            if (rectangle.south < tilingScheme.rectangle.south) {
                rectangle.south = tilingScheme.rectangle.south;
            }
            if (rectangle.north > tilingScheme.rectangle.north) {
                rectangle.north = tilingScheme.rectangle.north;
            }

            // Check the number of tiles at the minimum level.  If it's more than four,
            // try requesting the lower levels anyway, because starting at the higher minimum
            // level will cause too many tiles to be downloaded and rendered.
            var swTile = tilingScheme.positionToTileXY(Rectangle.southwest(rectangle), minimumLevel);
            var neTile = tilingScheme.positionToTileXY(Rectangle.northeast(rectangle), minimumLevel);
            var tileCount = (Math.abs(neTile.x - swTile.x) + 1) * (Math.abs(neTile.y - swTile.y) + 1);
            if (tileCount > 4) {
                minimumLevel = 0;
            }

            var templateUrl = joinUrls(url, '{z}/{x}/{reverseY}.' + fileExtension);

            deferred.resolve({
                url : templateUrl,
                tilingScheme : tilingScheme,
                rectangle : rectangle,
                tileWidth : tileWidth,
                tileHeight : tileHeight,
                minimumLevel : minimumLevel,
                maximumLevel : maximumLevel,
                proxy : options.proxy,
                tileDiscardPolicy : options.tileDiscardPolicy,
                credit: options.credit
            });
        }

        function metadataFailure(error) {
            // Can't load XML, still allow options and defaults
            var fileExtension = defaultValue(options.fileExtension, 'png');
            var tileWidth = defaultValue(options.tileWidth, 256);
            var tileHeight = defaultValue(options.tileHeight, 256);
            var minimumLevel = defaultValue(options.minimumLevel, 0);
            var maximumLevel = options.maximumLevel;
            var tilingScheme = defined(options.tilingScheme) ? options.tilingScheme : new WebMercatorTilingScheme({ ellipsoid : options.ellipsoid });
            var rectangle = defaultValue(options.rectangle, tilingScheme.rectangle);

            var templateUrl = joinUrls(url, '{z}/{x}/{reverseY}.' + fileExtension);

            deferred.resolve({
                url : templateUrl,
                tilingScheme : tilingScheme,
                rectangle : rectangle,
                tileWidth : tileWidth,
                tileHeight : tileHeight,
                minimumLevel : minimumLevel,
                maximumLevel : maximumLevel,
                proxy : options.proxy,
                tileDiscardPolicy : options.tileDiscardPolicy,
                credit: options.credit
            });
        }

        function requestMetadata() {
            var resourceUrl = joinUrls(url, 'tilemapresource.xml');
            var proxy = options.proxy;
            if (defined(proxy)) {
                resourceUrl = proxy.getURL(resourceUrl);
            }
            // Try to load remaining parameters from XML
            when(RequestScheduler.request(resourceUrl, loadXML), metadataSuccess, metadataFailure);
        }

        requestMetadata();
        return imageryProvider;
    }

    return createTileMapServiceImageryProvider;
});
