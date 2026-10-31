

const applyButton = document.querySelector('.apply');
const defaultFontSizeInput = document.getElementById('default-font-size-input');
const autoSaveCheckbox = document.getElementById('auto-save-checkbox');

const spotifyButton = document.querySelector('.spotify-button');
const spotifyConnected = document.querySelector('.spotify-connected');
const spotifyCheckbox = document.getElementById('spotify-checkbox');

const driveButton = document.querySelector('.link-drive-button');
const driveConnected = document.querySelector('.drive-connected');


function checkDriveCheckbox(){
    if(localStorage.getItem('google_drive_access_token') && localStorage.getItem('google_drive_access_token') !== 'null' && document.querySelector('.active')){
        driveCheckbox.disabled = false;
        document.querySelector('.drive-toolbar').classList.remove('disabled');
    }
}

if(!localStorage.getItem('view-spotify-popup')){
    localStorage.setItem('view-spotify-popup', true);
}

function getSettings(){
    //defaultFontSize
    if(!localStorage.getItem('defaultFontSize')){
        localStorage.setItem('defaultFontSize', 14)
    }
    
    document.getElementById('default-font-size-input').value = localStorage.getItem('defaultFontSize');
    const style = document.querySelector('.font-size');
    style.textContent = `
        #content span, #content p{
            font-size: ${localStorage.getItem('defaultFontSize')}px;
            line-height: calc(${localStorage.getItem('defaultFontSize')}px + 4px);
            height: calc(${localStorage.getItem('defaultFontSize')}px + 4px);
        }
    `;

    //autoSave
    if(localStorage.getItem('autoSave') === 'true'){
        autoSaveCheckbox.checked = true;
    }else{
        autoSaveCheckbox.checked = false;
    }

    //spotify
    if(localStorage.getItem('spotify_access_token') && localStorage.getItem('spotify_access_token') !== 'null'){
        spotifyButton.style.display = 'none';
        spotifyConnected.style.display = 'flex';
    }else{
        spotifyButton.style.display = 'flex';
        spotifyConnected.style.display = 'none';
    }

    if(localStorage.getItem('view-spotify-popup') === 'true'){
        spotifyCheckbox.checked = true;
        document.querySelector('.spotify').style.display = 'flex';
    }else{
        spotifyCheckbox.checked = false;
        document.querySelector('.spotify').style.display = 'none';
    }

    //drive
    if(localStorage.getItem('google_drive_access_token') && localStorage.getItem('google_drive_access_token') !== 'null'){
        driveButton.style.display = 'none';
        driveConnected.style.display = 'flex';
        document.querySelector('.import-drive-label').style.display = 'flex';
    }else{
        driveButton.style.display = 'flex';
        driveConnected.style.display = 'none';
        document.querySelector('.import-drive-label').style.display = 'none';
    }

    checkDriveCheckbox();
}

function setSettings(){

    //defaultFontSize
    if (/^(8|9|[1-2][0-9]|3[0-2])$/.test(defaultFontSizeInput.value)){
        localStorage.setItem('defaultFontSize', defaultFontSizeInput.value); 
        
        const style = document.querySelector('.font-size');
        style.textContent = `
            span, p {
                font-size: ${localStorage.getItem('defaultFontSize')}px;
            }
        `;           
    } else {
        defaultFontSizeInput.value = localStorage.getItem('defaultFontSize');
    }

    //autoSave
    if (autoSaveCheckbox.checked){
        localStorage.setItem('autoSave', true);            
    } else {
        localStorage.setItem('autoSave', false);            
    }

    //spotify
    if (spotifyCheckbox.checked){
        localStorage.setItem('view-spotify-popup', true);
        document.querySelector('.spotify').style.display = 'flex';
    } else {
        localStorage.setItem('view-spotify-popup', false);
        document.querySelector('.spotify').style.display = 'none';
    }

    //drive
}

getSettings();