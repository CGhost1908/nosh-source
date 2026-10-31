const spotify = document.querySelector('.spotify');

const togglePlayButton = document.getElementById('toggle-play');
const pauseButton = document.getElementById('pause');
const prevButton = document.getElementById('prev');
const nextButton = document.getElementById('next');

let spotifyPopup = localStorage.getItem('view-spotify-popup');

let isPlaying = null;

let spotifyToken = localStorage.getItem('spotify_access_token');

if(localStorage.getItem('spotify_access_token')){
    spotifyToken = localStorage.getItem('spotify_access_token');
}else{
    localStorage.setItem('spotify_access_token', 'null');
}

let intervalId = null;

function spotifySituation() {
    spotifyToken = localStorage.getItem('spotify_access_token');
    if (spotifyToken !== 'null' && spotifyPopup) {
        if (intervalId === null) {
            getCurrentlyPlayingTrack(spotifyToken);
            intervalId = setInterval(() => {
                getCurrentlyPlayingTrack(spotifyToken);
            }, 3000);
        }
    } else {
        if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
        }
    }
}

function connectSpotify(){
    const redirectUri = `http://localhost:${port}/callback`;
    const scope = 'streaming user-read-email user-read-private user-read-playback-state user-read-currently-playing user-read-playback-state user-modify-playback-state streaming';
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${spotifyClientId}&response_type=code&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scope)}`;

    const authWindow = window.open(authUrl, '_blank');
    const checkWindowClosed = setInterval(() => {
        if(authWindow.closed){
            getSettings();
            clearInterval(checkWindowClosed);
            spotifySituation();
        }
    }, 1000);
}

ipcRenderer.on('spotify-token', (event, tokens) => {
    const { access_token, refresh_token } = tokens;
    localStorage.setItem('spotify_access_token', access_token);
    localStorage.setItem('spotify_refresh_token', refresh_token);

    spotifyToken = access_token;
});

async function refreshSpotifyToken(){
    const refreshToken = localStorage.getItem('spotify_refresh_token');
    const url = "https://accounts.spotify.com/api/token";
    
    const payload = {
       method: 'POST',
       headers: {
         'Content-Type': 'application/x-www-form-urlencoded',
         'Authorization': `Basic ${btoa(spotifyClientId + ':' + spotifyClientSecret)}`
       },
       body: new URLSearchParams({
         grant_type: 'refresh_token',
         refresh_token: refreshToken,
         client_id: spotifyClientId
       }),
    };

    try {
        const response = await fetch(url, payload);
        const data = await response.json();
        localStorage.setItem('spotify_access_token', data.access_token);
        spotifyToken = data.access_token;
        if (data.refresh_token) {
            localStorage.setItem('spotify_refresh_token', data.refresh_token);
        }
    } catch (error) {
        console.error('Error refreshing Spotify token:', error);
    }
}



function unlinkSpotify(){
    localStorage.setItem('spotify_access_token', null);
    spotifySituation();
    getCurrentlyPlayingTrack();
    togglePlayButton.innerHTML = '<iconify-icon icon="mi:play"></iconify-icon>';
    isPlaying = false;
    getSettings();
}

function getCurrentlyPlayingTrack(token){

    checkPlaybackState();

    const url = 'https://api.spotify.com/v1/me/player/currently-playing';
 
    fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data && data.item){
            const trackName = data.item.name;
            const artistName = data.item.artists.map(artist => artist.name).join(', ');
            const albumName = data.item.album.name;
            const trackUrl = data.item.external_urls.spotify;
            const trackImage = data.item.album.images[0].url;

            document.querySelector('.track-name').textContent !== trackName && (document.querySelector('.track-name').textContent = trackName);
            document.querySelector('.artist-name').textContent !== artistName && (document.querySelector('.artist-name').textContent = artistName);
            document.querySelector('.album-photo').src !== trackImage && (document.querySelector('.album-photo').src = trackImage);
        } else {
            document.querySelector('.track-name').textContent = 'No track playing';
            document.querySelector('.artist-name').textContent = '--';
            document.querySelector('.album-photo').src = 'https://storage.googleapis.com/pr-newsroom-wp/1/2023/05/Spotify_Primary_Logo_RGB_White.png';
        }
    })
    .catch(error => {
        console.log('Error fetching currently playing track:', error);
    });
}
//controls
togglePlayButton.addEventListener('click', () => {
    if(isPlaying == true){
        isPlaying = false;
        fetch('https://api.spotify.com/v1/me/player/pause', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${spotifyToken}`,
                'Content-Type': 'application/json'
            }
        }).then(response => {
            if (!response.ok) {
                console.log('Error playing music');
            }else{
                togglePlayButton.innerHTML = '<iconify-icon icon="mi:play"></iconify-icon>'
            }
        });
    }else{
        isPlaying = true;
        fetch('https://api.spotify.com/v1/me/player/play', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${spotifyToken}`,
                'Content-Type': 'application/json'
            }
        }).then(response => {
            if (!response.ok) {
                console.log('Error playing music');
            }else{
                togglePlayButton.innerHTML = '<iconify-icon icon="mi:pause"></iconify-icon>'
            }
        });
    }
});
nextButton.addEventListener('click', () => {
    fetch('https://api.spotify.com/v1/me/player/next', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${spotifyToken}`,
        }
    }).then(response => {
        if(!response.ok) {
            console.log('Error skipping to next track');
        }else{
            setTimeout(() => {
                getCurrentlyPlayingTrack(spotifyToken);
            }, 500);
        }
    });
});
prevButton.addEventListener('click', () => {
    fetch('https://api.spotify.com/v1/me/player/previous', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${spotifyToken}`,
        }
    }).then(response => {
        if(!response.ok){
            console.log('Error going to previous track');
        }else{
            setTimeout(() => {
                getCurrentlyPlayingTrack(spotifyToken);
            }, 500);
        }
    })
});

let isDragging = false;


//check playback
function checkPlaybackState(){
    fetch('https://api.spotify.com/v1/me/player', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${spotifyToken}`
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        if(data.is_playing){
            isPlaying !== true && (togglePlayButton.innerHTML = '<iconify-icon icon="mi:pause"></iconify-icon>') && (isPlaying = true);
        } else {
            isPlaying !== false && (togglePlayButton.innerHTML = '<iconify-icon icon="mi:play"></iconify-icon>') && (isPlaying = false);
        }
        if(data.device){
            const volumePercent = data.device.volume_percent;
            if (!isDragging && volumePercent !== $("#slider").data("roundSlider").option("value")) {
                $("#slider").data("roundSlider").option("value", volumePercent);
            }                        
        }
    })
    .catch(error => {
        if (error.message.includes('401') && spotifyToken !== 'null'){
            // localStorage.setItem('spotify_access_token', 'null');
            // setSettings();
            refreshSpotifyToken();
        }
    });
}

$("#slider").roundSlider({
	radius: 35,
	circleShape: "pie",
    startAngle: 315,
    sliderType: "min-range",
	mouseScrollAction: true,
    color: "#31a24c",
    value: 0,
	handleSize: "+10",
    color: "#31a24c",
	min: 0,
	max: 100,
    width: 5,
    editableTooltip: false,    
    change: "changeVolume",
    start: function () {
        isDragging = true;
    },
    stop: function () {
        isDragging = false;
    }
});

function changeVolume(e){
    setVolume(e.value);
}

function setVolume(volume) {
    const url = `https://api.spotify.com/v1/me/player/volume?volume_percent=${volume}`;
    const headers = {
        'Authorization': `Bearer ${spotifyToken}`,
        'Content-Type': 'application/json'
    };

    const data = JSON.stringify({
        volume_percent: volume
    });

    fetch(url, {
        method: 'PUT',
        headers: headers,
        body: data
    })
    .then(response => response.json())
    .catch(error => console.error('Error:', error));
}


spotifySituation();