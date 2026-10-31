const { localservices } = require("googleapis/build/src/apis/localservices");

async function invokeSavesDir(){
    if(localStorage.getItem('saves-path') && localStorage.getItem('saves-path') !== 'null'){
        savesDir = localStorage.getItem('saves-path');
    }else{
        savesDir = await ipcRenderer.invoke('get-save-path');
        localStorage.setItem('saves-path', savesDir);
    }
    
    document.querySelector('#save-path-input').value = savesDir;
}

async function readDatabase(file){
    
    await invokeSavesDir();

    const files = await fsPromises.readdir(savesDir);
    const nshFiles = files.filter(file => path.extname(file) === '.nsh');

    document.querySelectorAll('.exist-file').forEach(file => file.classList.remove('exist-file'));

    for(const file of nshFiles){
        const filePath = path.join(savesDir, file);
        try {
            const data = await fsPromises.readFile(filePath, 'utf8');
            if(document.querySelector(`[file-name="${file.slice(0, -4)}"]`)){
                document.querySelector(`[file-name="${file.slice(0, -4)}"]`).classList.add('exist-file');
            }else{
                createElement(file);
            }
        }catch(err){
            console.error(err);
        }
    }

    sortSaves();
    deleteNonExistFiles();

    if(localStorage.getItem('google_drive_access_token') && localStorage.getItem('google_drive_access_token') !== 'null'){
        await getNoshFilesFromDrive();
    }
}


function deleteNonExistFiles(){
    const saves = document.querySelectorAll('.save');
    saves.forEach(save => {
        if(!save.classList.contains('exist-file')){
            save.remove();
        }
    });
}

function createElement(file, isDriveFile){
    const fileName = file.slice(0, -4);
    const savesSection = document.querySelector('.saves');
    const saves = savesSection.children;

    //createsave
    const createSave = document.createElement('p');
    createSave.id = `save${saves.length+1}`;
    createSave.classList.add('save');
    createSave.classList.add('exist-file');
    createSave.classList.add('text-overflow');
    createSave.setAttribute('file-name', fileName);
    createSave.textContent = fileName;
    createSave.onclick = function(){
        openDesiredFile(fileName)
    }
    savesSection.insertBefore(createSave, savesSection.firstChild);
    updateButtonListeners();
}


//START PROGRAM
readDatabase();


function refreshElement(file){
    const fileName = file.slice(0, -4);
    const savesSection = document.querySelector('.saves');
    const saves = savesSection.children;
    let thisFileAlreadyExist = false;

    for(let i = 0; i < saves.length; i++){
        if(saves[i].getAttribute('file-name') === fileName){
            thisFileAlreadyExist = true;
        }
    }
    if(!thisFileAlreadyExist){
        createElement(file);
    }
}



async function deleteSave(saveName) {
    if(saveName){
        const filePath = `${savesDir}/${saveName}.nsh`;
        try{
            await fsPromises.unlink(filePath);

            await document.querySelector(`[file-name="${saveName}"]`).remove();

            if(!document.querySelector(`.active`)){
                console.log('dosya yok');
                content.innerHTML = home;
                checkTitle();
            }
        }catch(err){
            console.error("Error deleting file:", err);
        }
    }
}


const removeRange = document.querySelector('.remove-range');
removeRange.addEventListener('change', function(){
    if(removeRange.value == 100){
        removeRange.value = 50;
        closeOverlay();
        deleteSave(document.querySelector('.active').getAttribute('file-name'));
    }else if(removeRange.value == 0){
        removeRange.value = 50;
        closeOverlay();
    }else{
        removeRange.value = 50;
    }
})

function renameSave(saveName){
    const filePath = `${savesDir}/${saveName}.nsh`;
    
    const currentSave = document.querySelector(`[file-name="${saveName}"]`);

    currentSave.setAttribute('contenteditable', true);
    currentSave.setAttribute('spellcheck', true);
    currentSave.classList.remove('text-overflow');
    currentSave.style.display = 'flex'
    // currentSave.focus();

    const range = document.createRange();
    range.selectNodeContents(currentSave);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
}


document.addEventListener('click', handleEndRename);
document.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') {
        handleEndRename(event);
    }
});
document.addEventListener('contextmenu', handleEndRename);

function handleEndRename(event) {
    const contextMenu = document.getElementById('context-menu');
    const saveElements = document.querySelectorAll('.save');
    const isRenaming = Array.from(saveElements).some(save => save.getAttribute('contenteditable') === 'true');
    const editableSave = Array.from(saveElements).find(save => save.getAttribute('contenteditable') === 'true');
    const fileName = editableSave ? editableSave.getAttribute('file-name') : null;
    
    if (isRenaming && (!contextMenu || !contextMenu.contains(event.target))) {
        endRename(fileName);
    }
}


function endRename(saveName){
    const currentSave = document.querySelector(`[file-name="${saveName}"]`);

    // Return default CSS
    currentSave.setAttribute('contenteditable', false);
    currentSave.setAttribute('spellcheck', false);
    currentSave.style.display = 'grid';

    //Rename File
    const newName = currentSave.textContent;
    const nameSyntax = /^[A-Za-z0-9 _\-+()&@!%$#]{2,30}$/;
    const oldPath = `${savesDir}/${saveName}.nsh`;
    const newPath = `${savesDir}/${newName}.nsh`;
    if(nameSyntax.test(newName) && !fs.existsSync(newPath)){
        fs.rename(oldPath, newPath, (err) => {});
        currentSave.setAttribute('file-name', newName);
        currentSave.onclick = function(){
            openDesiredFile(newName)
        }
        checkTitle();

        //Rename in Drive
        renameFileDrive(saveName, newName);
    }else{
        showInvalidNameNotification();
        currentSave.textContent = saveName;
    }
}

async function sortSavesDate(){

    const savesElement = document.querySelector('.saves');
    const itemsArray = Array.from(savesElement.children);

    const filePromises = itemsArray.map(item => {
        const filePath = path.join(savesDir, item.textContent + '.nsh');
        return fs.promises.stat(filePath).then(stat => ({
            item,
            mtime: stat.mtime
        }));
    });

    const fileStats = await Promise.all(filePromises);

    fileStats.sort((a, b) => b.mtime - a.mtime);

    savesElement.innerHTML = '';
    fileStats.forEach(fileStat => savesElement.appendChild(fileStat.item));
}

