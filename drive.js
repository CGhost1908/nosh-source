const { drive } = require("googleapis/build/src/apis/drive");
const { file } = require("googleapis/build/src/apis/file");

const driveClientId = "";
const driveClientSecret = "";
const driveCallback = "http://localhost:2222/drive-callback";


function linkDrive(){
    const oAuth2Client = new google.auth.OAuth2(driveClientId, driveClientSecret, driveCallback);
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/drive.file"],
    });
    window.open(authUrl);
}

let driveToken = localStorage.getItem('google_drive_access_token');

ipcRenderer.on("drive-token", (event, tokens) => {
    const { access_token, refresh_token } = tokens;
    localStorage.setItem('google_drive_access_token', access_token);
    localStorage.setItem('google_drive_refresh_token', refresh_token);
    driveToken = access_token;
    getSettings();
    importAllFilesFromDrive();
});

async function uploadFileToDrive(filePath, content){
    const oAuth2Client = new google.auth.OAuth2(driveClientId, driveClientSecret);
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    oAuth2Client.setCredentials({ access_token: localStorage.getItem('google_drive_access_token')});

    let folderId = null;

    try {
        const res = await drive.files.list({
            q: "name = 'noshTheNotepad' and mimeType = 'application/vnd.google-apps.folder'",
            fields: "files(id, name)",
        });

        const files = res.data.files;
        if (files.length === 1) {
            folderId = files[0].id;
        } else if (files.length === 0) {
            new Notification('Google Drive', {
                body: "Please connect your Google Drive account again."
            });
            return;
        } else {
            new Notification('Google Drive', {
                body: "Must be only one 'noshTheNotepad' folder in your drive!"
            });
            return;
        }

        const fileName = filePath.split('/').pop();

        const fileRes = await drive.files.list({
            q: `name = '${fileName}' and '${folderId}' in parents`,
            fields: 'files(id, name)',
        });

        const file = fileRes.data.files;

        if (file.length > 0) {
            const fileId = file[0].id;
            const fileMetadata = {
                name: fileName,
            };

            const media = {
                mimeType: 'text/plain',
                body: content,
            };

            await drive.files.update({
                fileId: fileId,
                resource: fileMetadata,
                media: media,
            });

            console.log("Dosya başarıyla güncellendi.");
        } else {
            const fileMetadata = {
                name: fileName,
                parents: [folderId],
            };

            const media = {
                mimeType: 'text/plain',
                body: content,
            };

            const fileRes = await drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id',
            });

            console.log("Dosya başarıyla yüklendi. Dosya ID: " + fileRes.data.id);

            document.querySelector(`.save[file-name="${fileName.split('.')[0]}"]`).classList.add('drive-save');
        }
    } catch (err) {
        console.error("Hata oluştu: ", err);
    }
}


async function getNoshFilesFromDrive(){
    const oAuth2Client = new google.auth.OAuth2(driveClientId, driveClientSecret);
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    oAuth2Client.setCredentials({ access_token: localStorage.getItem('google_drive_access_token') });

    try {
        const folderRes = await drive.files.list({
            q: "name = 'noshTheNotepad' and mimeType = 'application/vnd.google-apps.folder'",
            fields: "files(id, name)",
        });

        const folders = folderRes.data.files;

        if (!folders || folders.length === 0) {
            alert("Folder not exist.");
            return;
        }

        const folderId = folders[0].id;

        const fileRes = await drive.files.list({
            q: `name contains '.nsh' and '${folderId}' in parents`,
            fields: "files(id, name)",
        });

        const files = fileRes.data.files;

        const availableSaves = document.querySelectorAll('.save')
        for(const file of files){
            stateDrive(file.name, false);
        }

    }catch(err){
        console.error(err);
        if(err.message.includes('Invalid Credentials')){
            refreshDriveToken();
        }
    }
}


function stateDrive(fileName, isNegative){
    const save = document.querySelector(`.save[file-name="${fileName.split('.')[0]}"]`);
    if(save){
        save.classList.add('drive-save');
    }
}


function unlinkDrive(){
    localStorage.setItem('google_drive_access_token', null);
    getSettings();
}


async function openFileFromDrive(filename){
    content.innerHTML = '<iconify-icon width="128px" icon="line-md:loading-loop"></iconify-icon>';
    const oAuth2Client = new google.auth.OAuth2(driveClientId, driveClientSecret);
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    oAuth2Client.setCredentials({ access_token: localStorage.getItem('google_drive_access_token') });

    try {
        const folderRes = await drive.files.list({
            q: "name = 'noshTheNotepad' and mimeType = 'application/vnd.google-apps.folder'",
            fields: "files(id, name)",
        });

        const folders = folderRes.data.files;

        const folderId = folders[0].id;

        const fileRes = await drive.files.list({
            q: `name = '${filename}.nsh' and '${folderId}' in parents`,
            fields: 'files(id, name)',
        });

        const files = fileRes.data.files;

        if (files.length === 0) {
            console.log('Dosya bulunamadı');
            return;
        }

        const fileId = files[0].id;

        const fileContent = await drive.files.get({
            fileId: fileId,
            alt: 'media',
        });

        const saveContent = fileContent.data;
        console.log(content)
        content.innerHTML = saveContent;
        processCodeBlock();
    } catch (err) {
        console.error(err);
    }
}

const driveCheckbox = document.querySelector('.save-drive-checkbox');

driveCheckbox.addEventListener('change',function(){
    checkDriveCheckbox();
    if(driveCheckbox.checked){
        toggleDriveCheckbox();
    }else{
        driveCheckbox.checked = true;
        drivePopup();
    }
});


async function cancelDrive(){
    driveCheckbox.checked = false;
    toggleDriveCheckbox();
    closeOverlay();

    const oAuth2Client = new google.auth.OAuth2(driveClientId, driveClientSecret);
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    oAuth2Client.setCredentials({ access_token: localStorage.getItem('google_drive_access_token') });

    try {
        const active = document.querySelector('.active');
        const fileName = active.getAttribute('file-name');

        const folderRes = await drive.files.list({
            q: "name = 'noshTheNotepad' and mimeType = 'application/vnd.google-apps.folder'",
            fields: 'files(id, name)',
        });

        const folders = folderRes.data.files;
        const folderId = folders[0].id;

        const fileRes = await drive.files.list({
            q: `name = '${fileName}.nsh' and '${folderId}' in parents`,
            fields: 'files(id, name)',
        });

        const files = fileRes.data.files;

        const fileId = files[0].id;
        await drive.files.delete({ fileId: fileId });

        document.querySelector(`.save[file-name="${fileName.split('.')[0]}"]`).classList.remove('drive-save');
        
        console.log("File delete complete.")
    }catch(err){
        console.error(err);
    }
}


async function checkNonExistFilesDrive(){
    document.querySelector('.drive-saves').style.display = 'flex';

    const oAuth2Client = new google.auth.OAuth2(driveClientId, driveClientSecret);
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    oAuth2Client.setCredentials({ access_token: localStorage.getItem('google_drive_access_token') });

    try {
        const folderRes = await drive.files.list({
            q: "name = 'noshTheNotepad' and mimeType = 'application/vnd.google-apps.folder'",
            fields: "files(id, name)",
        });

        const folders = folderRes.data.files;

        if (!folders || folders.length === 0) {
            alert("Folder not exist.");
            return;
        }

        const folderId = folders[0].id;

        const fileRes = await drive.files.list({
            q: `name contains '.nsh' and '${folderId}' in parents`,
            fields: "files(id, name)",
        });
        
        let fileCount = 0;
        const files = fileRes.data.files;
        document.querySelector('.select-files').innerHTML = '';
        for(const file of files){
            if(!document.querySelector(`.save[file-name="${file.name.split('.')[0]}"]`)){
                const showDriveElement = document.createElement('div');
                showDriveElement.textContent = file.name;

                const createLabel = document.createElement('label');

                const importButton = document.createElement('button');
                importButton.textContent = 'Import';
                importButton.onclick = function() {
                    importFileFromDrive(file.name);
                    this.innerHTML = '<iconify-icon icon="eos-icons:loading"></iconify-icon>';
                    // setTimeout(() => {
                    //     this.innerHTML = 'Import';
                    // }, 2000);
                };

                const deleteButton = document.createElement('button');
                deleteButton.textContent = 'Delete';
                deleteButton.classList.add('drive-popup-delete-button');
                deleteButton.onclick = function(){
                    deleteFileFromDrive(file.name);
                    this.innerHTML = '<iconify-icon icon="eos-icons:loading"></iconify-icon>';
                };

                createLabel.appendChild(deleteButton);
                createLabel.appendChild(importButton);
                showDriveElement.appendChild(createLabel);
                document.querySelector('.select-files').appendChild(showDriveElement);
                fileCount++;
            }
        }
        document.querySelector('.drive-saves h3').textContent = `${fileCount} files found.`;

        
    }catch (err){
        console.error(err);
        if(err.message.includes('Invalid Credentials')){
            refreshDriveToken();
        }
    }
}

async function importFileFromDrive(fileName){
    const oAuth2Client = new google.auth.OAuth2(driveClientId, driveClientSecret);
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });
    
    oAuth2Client.setCredentials({ access_token: localStorage.getItem('google_drive_access_token')});
    
    const res = await drive.files.list({
        q: `name = '${fileName}'`,
        fields: 'files(id, name)',
    });
    
    const files = res.data.files;
    const file = files[0];
    const fileId = file.id;
    
    const filePath = path.join(savesDir, fileName);
    try{
        const response = await drive.files.get({
            fileId: fileId,
            alt: 'media',
        });
    
        const fileData = response.data;
    
        fs.writeFileSync(filePath, fileData);

        await readDatabase();

        checkNonExistFilesDrive();

    }catch(err){
        console.log(err);
    }
}


async function refreshDriveToken(){
    const oAuth2Client = new google.auth.OAuth2(
        driveClientId,
        driveClientSecret,
        'http://localhost:2222/drive-callback'
    );
    
    oAuth2Client.setCredentials({
        refresh_token: localStorage.getItem('google_drive_refresh_token'),
    });

    try {
        const newTokens = await oAuth2Client.getAccessToken();
        const accessToken = newTokens.token;

        readDatabase();
        localStorage.setItem('google_drive_access_token', accessToken);
    } catch (error) {
        console.error(error);
    }
}


async function renameFileDrive(saveName, newName){
    const newFileName = newName + '.nsh';

    const oAuth2Client = new google.auth.OAuth2(driveClientId, driveClientSecret);
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });
    oAuth2Client.setCredentials({ access_token: localStorage.getItem('google_drive_access_token') });

    const response = await drive.files.list({
        q: `name = '${saveName}.nsh'`,
        fields: 'files(id, name)',
    });

    const files = response.data.files;

    const file = files[0];
    const fileId = file.id;

    try {
        const response = await drive.files.update({
            fileId: fileId,
            resource: {
                name: newFileName,
            },
            fields: 'id, name',
        });

    } catch (error) {
        console.error(error);
    }
}


async function deleteFileFromDrive(fileName){
    const oAuth2Client = new google.auth.OAuth2(driveClientId, driveClientSecret);
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });
    
    oAuth2Client.setCredentials({ access_token: localStorage.getItem('google_drive_access_token')});
    
    const res = await drive.files.list({
        q: `name = '${fileName}'`,
        fields: 'files(id, name)',
    });
    
    const files = res.data.files;
    const file = files[0];
    const fileId = file.id;
    
    try{
        const response = await drive.files.delete({
            fileId: fileId,
        });
    
        await readDatabase();

        checkNonExistFilesDrive();

    }catch(err){
        console.log(err);
    }
}


async function importAllFilesFromDrive(){
    const oAuth2Client = new google.auth.OAuth2(driveClientId, driveClientSecret);
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    oAuth2Client.setCredentials({ access_token: localStorage.getItem('google_drive_access_token') });

    try{
        const folderRes = await drive.files.list({
            q: "name = 'noshTheNotepad' and mimeType = 'application/vnd.google-apps.folder'",
            fields: "files(id, name)",
        });

        const folders = folderRes.data.files;

        if (!folders || folders.length === 0) {
            alert("Folder not exist.");
            return;
        }

        const folderId = folders[0].id;

        const fileRes = await drive.files.list({
            q: `name contains '.nsh' and '${folderId}' in parents`,
            fields: "files(id, name)",
        });
        
        const files = fileRes.data.files;
        for(const file of files){
            await importFileFromDrive(file.name);
        }
    }catch(err){
        console.log(err);
    }
}