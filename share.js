
function generateRandomID(){
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 25; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}


document.getElementById('share-file').addEventListener('click', async() => {
    overlay.style.opacity = ".3";
    overlay.style.pointerEvents = "all";
    popupSection.style.opacity = "1";
    popupSection.style.pointerEvents = "all";
    document.querySelector('.share-confirm-popup').style.opacity = "1";
    document.querySelector('.share-confirm-popup').style.pointerEvents = "all";
});


function publishFile(){
    document.querySelector('.confirm-publish').innerHTML = 'Publishing<iconify-icon icon="eos-icons:three-dots-loading"></iconify-icon>';
    document.querySelectorAll('.share-confirm-popup button').forEach((button) => button.disabled = true);
    overlay.style.pointerEvents = "none";
    const randomID = generateRandomID();
    const htmlContent = document.getElementById('content').innerHTML;
    
    const fileContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <link rel="icon" href="../icon.ico" type="image/x-icon">
            <title>${document.querySelector('.active').getAttribute('file-name')}</title>
        </head>
        <body>
            <nav class="top-nav">
                <img src="../icon.ico" onclick="window.location.href = 'https://cghost1908.github.io/nosh/';" class="top-nav-logo">
                <h2 class="page-title">${document.querySelector('.active').getAttribute('file-name')}</h2>
                <button class="top-nav-button" onclick="window.location.href = 'https://cghost1908.github.io/nosh/';">Download nosh</button>
            </nav>
            <div id="content">
            ${htmlContent}
            </div>
        </body>
        </html>
        <style>
            #content{
                width: 100%;
                max-width: 840px !important;
            }

            body{
                padding: 60px;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .top-nav{
                padding: 0 20px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                width: 100vw;
                height: 50px;
                position: fixed;
                top: 0;
                left: 0;
                background-color: #232323;
                z-index: 1000;
            }

            .top-nav-logo{
                display: flex;
                justify-self: flex-start;
                width: 40px;
                height: 40px;
                cursor: pointer;
            }
            .page-title{
                position: absolute;
                left: 50%;
                transform: translateX(-50%);
            }
            .top-nav-button{
                border: none;
                color: #fff;
                background-color: transparent;
                font-weight: bold;
                font-size: 20px;
                width: 180px;
                margin-right: 20px;
                border-radius: 10px;
                cursor: pointer;
                transition: 0.3s;
            }
            .top-nav-button:hover{
                transform: scale(1.1);
                color: #224478FF;
            }
        </style>
        <link rel="stylesheet" href="../view.css">
        <script>
        document.querySelectorAll('.delete-code-button').forEach((button) => button.remove());
        const CodeMirror = require('codemirror');
        const { basicSetup } = require("@codemirror/basic-setup");
        const { autocompletion } = require("@codemirror/autocomplete");
        require('codemirror/lib/codemirror');
        require('codemirror/addon/edit/closebrackets');
        require('codemirror/addon/hint/show-hint');
        require('codemirror/mode/clike/clike');
        require('codemirror/mode/javascript/javascript');
        require('codemirror/addon/hint/javascript-hint');
        require('codemirror/mode/htmlmixed/htmlmixed');
        require('codemirror/mode/xml/xml');  
        require('codemirror/addon/hint/html-hint');
        require('codemirror/mode/css/css');
        require('codemirror/addon/hint/css-hint');
        require('codemirror/mode/python/python');
        require('codemirror/mode/php/php');
        require('codemirror/mode/ruby/ruby');
        require('codemirror/mode/go/go');
        require('codemirror/mode/sql/sql');
        require('codemirror/mode/shell/shell');
        require('codemirror/mode/markdown/markdown');
        require('codemirror/mode/yaml/yaml');
        require('codemirror/mode/javascript/javascript'); 
        require('codemirror/mode/haskell/haskell'); 
        require('codemirror/mode/dart/dart'); 
        require('codemirror/mode/groovy/groovy'); 
        require('codemirror/mode/vhdl/vhdl'); 
        require('codemirror/mode/verilog/verilog'); 
        require('codemirror/mode/clojure/clojure'); 
        require('codemirror/mode/swift/swift'); 
        require('codemirror/mode/rust/rust'); 
        require('codemirror/mode/elm/elm'); 
        require('codemirror/mode/crystal/crystal'); 
        require('codemirror/mode/r/r'); 
        require('codemirror/mode/d/d'); 
        require('codemirror/mode/tcl/tcl'); 
        require('codemirror/mode/powershell/powershell'); 
        require('codemirror/mode/xml/xml'); 
        function processCodeBlock(){
            removeAllCodeMirrors();
            const codeBlocks = document.querySelectorAll('.code');
            codeBlocks.forEach((textarea) => {
                const language = textarea.getAttribute('language');

                const codeBlock = CodeMirror.fromTextArea(textarea, {
                    lineNumbers: true,
                    mode: language,
                    theme: "dracula",
                    autoCloseBrackets: true,
                    indentUnit: 4,
                    smartIndent: true,
                    indentWithTabs: true,
                    matchBrackets: true,
                    fixedGutter: true,
                    keyMap: "sublime",
                    extensions: [
                        basicSetup,
                        autocompletion()
                    ],
                });
                codeBlock.setSize("100%", "auto");
                codeBlock.on('change', function(instance) {
                    let content = instance.getValue();
                    textarea.textContent = content;
                });
            });
        }
        function removeAllCodeMirrors() {
            const codeMirrors = document.querySelectorAll('.CodeMirror');
            codeMirrors.forEach(function(codeMirror) {
                codeMirror.remove();
            });
        }
        processCodeBlock();
        </script>
        <script src="https://code.iconify.design/2/2.0.3/iconify.min.js"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/codemirror.min.css">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/roundSlider/1.3.2/roundslider.min.css" rel="stylesheet" />
        <!--Themes-->
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/3024-day.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/3024-night.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/abbott.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/abcdef.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/ambiance.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/ambiance-mobile.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/ayu-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/ayu-mirage.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/base16-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/base16-light.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/bespin.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/blackboard.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/cobalt.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/colorforth.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/darcula.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/dracula.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/duotone-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/duotone-light.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/eclipse.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/elegant.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/erlang-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/gruvbox-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/hopscotch.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/icecoder.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/idea.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/isotope.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/juejin.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/lesser-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/liquibyte.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/lucario.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/material.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/material-darker.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/material-ocean.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/material-palenight.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/mbo.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/mdn-like.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/midnight.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/monokai.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/moxer.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/neat.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/neo.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/night.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/nord.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/oceanic-next.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/panda-syntax.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/paraiso-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/paraiso-light.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/pastel-on-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/railscasts.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/rubyblue.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/seti.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/shadowfox.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/solarized.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/ssms.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/the-matrix.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/tomorrow-night-bright.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/tomorrow-night-eighties.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/ttcn.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/twilight.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/vibrant-ink.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/xq-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/xq-light.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/yeti.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/yonce.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/zenburn.css">
        <script src="https://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js"></script>
    `;

    ipcRenderer.send('upload-to-github', {
        fileContent: fileContent,
        randomID: randomID
    });
}


ipcRenderer.on('github-upload-response', (event, response) => {
    if(response.success){
        closeOverlay();
        document.querySelector('.confirm-publish').innerHTML = 'Publish';
        document.querySelectorAll('.share-confirm-popup button').forEach((button) => button.disabled = false);
        const shareLink = `https://cghost1908.github.io/nosh/uploads/${response.randomID}.html`;
        const shareLinkInput = document.querySelector('.share-link-input');
        shareLinkInput.value = shareLink;
        shareLinkInput.select();
        document.execCommand('copy');

        overlay.style.opacity = ".3";
        overlay.style.pointerEvents = "all";
        popupSection.style.opacity = "1";
        popupSection.style.pointerEvents = "all";
        document.querySelector('.github-uploaded-popup').style.opacity = "1";
        document.querySelector('.github-uploaded-popup').style.pointerEvents = "all";
        copiedNotification();

        const publishData = { 
            id: response.randomID, 
            name: document.querySelector('.active').getAttribute('file-name') 
        };

        if(localStorage.getItem("publishedFiles") === null){
            localStorage.setItem("publishedFiles", JSON.stringify([]));
        }

        const storedFiles = JSON.parse(localStorage.getItem("publishedFiles")) || [];
        storedFiles.push(publishData);
        localStorage.setItem("publishedFiles", JSON.stringify(storedFiles));

    }else{
        
    }
});


function showPublishedFiles(){
    const publishedFiles = JSON.parse(localStorage.getItem("publishedFiles")) || [];
    const publishedFilesContainer = document.querySelector('.published-files-container');
    publishedFilesContainer.innerHTML = '';

    publishedFiles.forEach((file) => {
        const fileElement = document.createElement('div');
        fileElement.classList.add('published-file');
        fileElement.setAttribute('file-id', file.id);
        const url = `https://cghost1908.github.io/nosh/uploads/${file.id}.html`;
        fileElement.innerHTML = `
            <nav style="width: 100%; max-width: 1000px;">
            <button onclick="shell.openExternal('${url}')">Open in Browser</button>
            <button onclick="navigator.clipboard.writeText('${url}'); copiedNotification();">Copy Link</button>
            <button onclick="updatePublishedFile('${file.id}')">Update</button>
            <button onclick="deletePublishedFile('${file.id}')">Delete</button>
            </nav>
            <webview 
                class="file-preview" 
                src="${url}" 
                style="width: 100%; height: 400px; max-width: 1000px; border: 2px solid #ffffff27; pointer-events: none; border-radius: 0px;">
            </webview>
            <!--<script>
                const webview = document.querySelector('.file-preview');

                webview.addEventListener('did-attach', () => {
                    webview.setZoomFactor(0.1);
                });
            </script>-->
        `;
        publishedFilesContainer.appendChild(fileElement);
    });
}

async function getFileSHA(fileId){
    const githubURL = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/uploads/${fileId}.html`;
    
    const response = await fetch(githubURL, {
        method: 'GET',
        headers: {
            'Authorization': `token ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });

    if(response.ok){
        const data = await response.json();
        return data.sha;
    }else{
        alert('SHA Error!')
    }
}


async function deletePublishedFile(fileId){
    const githubURL = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/uploads/${fileId}.html`;
    const sha = await getFileSHA(fileId);

    document.querySelector('.published-files-busy').style.display = "flex";

    const response = await fetch(githubURL, {
        method: 'DELETE',
        headers: {
            'Authorization': `token ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
            message: `Delete ${fileId}.html`,
            sha: sha
        })
    });
    if (response.ok){
        let storedFiles = JSON.parse(localStorage.getItem("publishedFiles")) || [];
        storedFiles = storedFiles.filter(file => file.id !== fileId);
        localStorage.setItem("publishedFiles", JSON.stringify(storedFiles));
        document.querySelector(`[file-id="${fileId}"]`).remove();

    }else{
        alert('An error occurred while deleting the file.');
    }
    document.querySelector('.published-files-busy').style.display = "none";
}

let isEventListenerAddedToUpdateFileButton = false;

function updatePublishedFile(fileId){
    showSavesPopup();

    function updateFileClickHandler(){
        const fileName = document.querySelector('.files-popup .selected span').textContent;
        confirmUpdateFile(fileId, fileName);
    }
    
    const updateFileButton = document.querySelector('.update-file-website');

    if (!isEventListenerAddedToUpdateFileButton) {
        updateFileButton.addEventListener('click', updateFileClickHandler);
        isEventListenerAddedToUpdateFileButton = true;
    }
}

async function confirmUpdateFile(fileId, sendingFile){
    document.querySelector('.files-popup-loading').style.display = 'flex';

    const filePath = path.join(savesDir, `${sendingFile}.nsh`);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const webContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <link rel="icon" href="../icon.ico" type="image/x-icon">
            <title>${sendingFile}</title>
        </head>
        <body>
            <nav class="top-nav">
                <img src="../icon.ico" onclick="window.location.href = 'https://cghost1908.github.io/nosh/';" class="top-nav-logo">
                <h2 class="page-title">${sendingFile}</h2>
                <button class="top-nav-button" onclick="window.location.href = 'https://cghost1908.github.io/nosh/';">Download nosh</button>
            </nav>
            <div id="content">
            ${fileContent}
            </div>
        </body>
        </html>
        <style>
            #content{
                width: 100%;
                max-width: 840px !important;
            }

            body{
                padding: 60px;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .top-nav{
                padding: 0 20px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                width: 100vw;
                height: 50px;
                position: fixed;
                top: 0;
                left: 0;
                background-color: #232323;
                z-index: 1000;
            }

            .top-nav-logo{
                display: flex;
                justify-self: flex-start;
                width: 40px;
                height: 40px;
                cursor: pointer;
            }
            .page-title{
                position: absolute;
                left: 50%;
                transform: translateX(-50%);
            }
            .top-nav-button{
                border: none;
                color: #fff;
                background-color: transparent;
                font-weight: bold;
                font-size: 20px;
                width: 180px;
                margin-right: 20px;
                border-radius: 10px;
                cursor: pointer;
                transition: 0.3s;
            }
            .top-nav-button:hover{
                transform: scale(1.1);
                color: #224478FF;
            }
        </style>
        <link rel="stylesheet" href="../view.css">
        <script>
        document.querySelectorAll('.delete-code-button').forEach((button) => button.remove());
        const CodeMirror = require('codemirror');
        const { basicSetup } = require("@codemirror/basic-setup");
        const { autocompletion } = require("@codemirror/autocomplete");
        require('codemirror/lib/codemirror');
        require('codemirror/addon/edit/closebrackets');
        require('codemirror/addon/hint/show-hint');
        require('codemirror/mode/clike/clike');
        require('codemirror/mode/javascript/javascript');
        require('codemirror/addon/hint/javascript-hint');
        require('codemirror/mode/htmlmixed/htmlmixed');
        require('codemirror/mode/xml/xml');  
        require('codemirror/addon/hint/html-hint');
        require('codemirror/mode/css/css');
        require('codemirror/addon/hint/css-hint');
        require('codemirror/mode/python/python');
        require('codemirror/mode/php/php');
        require('codemirror/mode/ruby/ruby');
        require('codemirror/mode/go/go');
        require('codemirror/mode/sql/sql');
        require('codemirror/mode/shell/shell');
        require('codemirror/mode/markdown/markdown');
        require('codemirror/mode/yaml/yaml');
        require('codemirror/mode/javascript/javascript'); 
        require('codemirror/mode/haskell/haskell'); 
        require('codemirror/mode/dart/dart'); 
        require('codemirror/mode/groovy/groovy'); 
        require('codemirror/mode/vhdl/vhdl'); 
        require('codemirror/mode/verilog/verilog'); 
        require('codemirror/mode/clojure/clojure'); 
        require('codemirror/mode/swift/swift'); 
        require('codemirror/mode/rust/rust'); 
        require('codemirror/mode/elm/elm'); 
        require('codemirror/mode/crystal/crystal'); 
        require('codemirror/mode/r/r'); 
        require('codemirror/mode/d/d'); 
        require('codemirror/mode/tcl/tcl'); 
        require('codemirror/mode/powershell/powershell'); 
        require('codemirror/mode/xml/xml'); 
        function processCodeBlock(){
            removeAllCodeMirrors();
            const codeBlocks = document.querySelectorAll('.code');
            codeBlocks.forEach((textarea) => {
                const language = textarea.getAttribute('language');

                const codeBlock = CodeMirror.fromTextArea(textarea, {
                    lineNumbers: true,
                    mode: language,
                    theme: "dracula",
                    autoCloseBrackets: true,
                    indentUnit: 4,
                    smartIndent: true,
                    indentWithTabs: true,
                    matchBrackets: true,
                    fixedGutter: true,
                    keyMap: "sublime",
                    extensions: [
                        basicSetup,
                        autocompletion()
                    ],
                });
                codeBlock.setSize("100%", "auto");
                codeBlock.on('change', function(instance) {
                    let content = instance.getValue();
                    textarea.textContent = content;
                });
            });
        }
        function removeAllCodeMirrors() {
            const codeMirrors = document.querySelectorAll('.CodeMirror');
            codeMirrors.forEach(function(codeMirror) {
                codeMirror.remove();
            });
        }
        processCodeBlock();
        </script>
        <script src="https://code.iconify.design/2/2.0.3/iconify.min.js"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/codemirror.min.css">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/roundSlider/1.3.2/roundslider.min.css" rel="stylesheet" />
        <!--Themes-->
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/3024-day.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/3024-night.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/abbott.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/abcdef.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/ambiance.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/ambiance-mobile.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/ayu-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/ayu-mirage.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/base16-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/base16-light.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/bespin.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/blackboard.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/cobalt.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/colorforth.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/darcula.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/dracula.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/duotone-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/duotone-light.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/eclipse.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/elegant.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/erlang-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/gruvbox-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/hopscotch.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/icecoder.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/idea.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/isotope.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/juejin.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/lesser-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/liquibyte.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/lucario.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/material.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/material-darker.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/material-ocean.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/material-palenight.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/mbo.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/mdn-like.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/midnight.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/monokai.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/moxer.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/neat.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/neo.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/night.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/nord.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/oceanic-next.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/panda-syntax.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/paraiso-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/paraiso-light.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/pastel-on-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/railscasts.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/rubyblue.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/seti.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/shadowfox.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/solarized.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/ssms.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/the-matrix.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/tomorrow-night-bright.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/tomorrow-night-eighties.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/ttcn.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/twilight.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/vibrant-ink.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/xq-dark.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/xq-light.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/yeti.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/yonce.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.0/theme/zenburn.css">
        <script src="https://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js"></script>
    `;

    const githubURL = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/uploads/${fileId}.html`;
    const sha = await getFileSHA(fileId);
    const response = await fetch(githubURL, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
            message: `Update ${fileId}.html`,
            content: Buffer.from(webContent).toString('base64'),
            sha: sha,
        }),
    });

    const data = await response.json();

    if(data.content){
        document.querySelector('.files-popup-loading').style.display = 'none';
        document.querySelector('.files-popup-success').style.display = 'flex';
    }else{
        alert('Failed to update file');
    }
}


async function showSavesPopup(){
    overlay.style.opacity = ".3";
    overlay.style.pointerEvents = "all";
    popupSection.style.opacity = "1";
    popupSection.style.pointerEvents = "all";
    document.querySelector('.files-popup').style.opacity = "1";
    document.querySelector('.files-popup').style.pointerEvents = "all";
    document.querySelector('.files-popup ul').innerHTML = '';

    const files = await fsPromises.readdir(savesDir);
    const nshFiles = files.filter(file => path.extname(file) === '.nsh');

    for(const file of nshFiles){
        const filePath = path.join(savesDir, file);
        const data = await fsPromises.readFile(filePath, 'utf8'); 
        const fileName = file.slice(0, -4);
        const filesPopupUl = document.querySelector('.files-popup ul');
        const createSave = document.createElement('li');
        createSave.onclick = function(){
            selectFile(fileName);
        }

        createSave.textContent = '📄 ' + fileName;

        filesPopupUl.appendChild(createSave);
    }
}


function selectFile(fileName){
    selected.querySelector("span").textContent = fileName;
    optionsList.classList.remove("active-option");
    selected.classList.remove("sharp");

    document.querySelector('.update-file-website').style.display = 'block';
}

//120
//3579
//621617
//