(function () {
    var key = window.GOOGLE_MAPS_API_KEY || window.GMAPS_KEY || '';
    if (!key) {
        console.warn('Google Maps API key não configurada.');
        return;
    }
    if (window.google && window.google.maps) {
        return;
    }

    var src = 'https://maps.googleapis.com/maps/api/js?key=' +
        encodeURIComponent(key) +
        '&language=pt-BR&libraries=geometry';

    document.write('<script src="' + src + '"><\\/script>');
})();
