
function createCodeBlock(language){
    //close overlay
	closeOverlay();

    //create main
    const main = document.createElement('div');

    //create code block
	const content = document.getElementById('content');
    const createCodeBlock = document.createElement('textarea');

    //create top layer
    const createCodeBlockLayer = document.createElement('div');
    createCodeBlockLayer.classList.add('code-block-layer');
    createCodeBlockLayer.setAttribute('contenteditable', false);
    const createDeleteCodeButton = document.createElement('iconify-icon');
    createDeleteCodeButton.setAttribute('icon', 'typcn:delete-outline');
    createDeleteCodeButton.classList.add('delete-code-button');
    const languageText = document.createElement('p');
    languageText.style.color = '#fff';
    languageText.textContent = language;
    createCodeBlockLayer.appendChild(languageText);
    createCodeBlockLayer.appendChild(createDeleteCodeButton);
    main.appendChild(createCodeBlockLayer);

	//Dili ekle
	createCodeBlock.setAttribute('language', language);
	createCodeBlock.setAttribute('name', 'code');
	createCodeBlock.classList.add('code');
    main.appendChild(createCodeBlock);
    
    content.appendChild(main);

    //Kod blogunu isle
    processCodeBlock();

}

function selectLanguage(){
	//CSS
	document.querySelector('.overlay').style.opacity = ".3";
    document.querySelector('.overlay').style.pointerEvents = "all";
    document.querySelector('.popup-section').style.opacity = "1";
    document.querySelector('.popup-section').style.pointerEvents = "all";
    document.querySelector('.language-popup').style.opacity = "1";
    document.querySelector('.language-popup').style.pointerEvents = "all";
    document.querySelector('.search-language').value = '';
    searchLanguage();
}

//Code mirror

function processCodeBlock(){

    removeAllCodeMirrors();

    const codeBlocks = document.querySelectorAll('.code');

    codeBlocks.forEach((textarea) => {
        const language = textarea.getAttribute('language');

        const codeBlock = CodeMirror.fromTextArea(textarea, {
            lineNumbers: true,
            mode: language,
            theme: localStorage.getItem('code-theme'),
            autoCloseBrackets: true,
            indentUnit: 4,
            smartIndent: true,
            indentWithTabs: true,
            matchBrackets: true,
            fixedGutter: true,
            keyMap: "sublime",
            extraKeys: {
                "Shift-Tab": "autocomplete",
                "Shift-Enter": function(){
                    const emptyLine = document.createElement('p');
                    emptyLine.className = 'empty-line';
                    emptyLine.tabIndex = '0';
                    content.insertBefore(emptyLine, textarea.nextSibling.nextSibling);
                    const range = document.createRange();
                    const selection = window.getSelection();
                    range.selectNodeContents(emptyLine);
                    range.collapse(false);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    emptyLine.focus();
                }
            },
            extensions: [
                basicSetup,
                autocompletion()
              ],
        });

        codeBlock.setSize("100%", "auto");
        
        // const createLayer = document.createElement('div');
        // createLayer.classList.add('code-block-layer');

        // const createDeleteButton = document.createElement('button');
        // createDeleteButton.classList.add('delete-code-block-button');

        // createLayer.appendChild(createDeleteButton);
        // codeBlock.getWrapperElement().appendChild(createLayer);

        codeBlock.on('change', function(instance) {
            let content = instance.getValue();
            textarea.textContent = content;
            setTimeout(() => {
                document.querySelectorAll('.CodeMirror *').forEach(el => el.classList.add('untouchable'));
            }, 0);
        });
    });
    setCodeBlockUntouchable();
}



function removeAllCodeMirrors() {
    const codeMirrors = document.querySelectorAll('.CodeMirror');
    codeMirrors.forEach(function(codeMirror) {
        codeMirror.remove();
    });
}


document.addEventListener('click', function(event) {

    const deleteCodeButtons = document.querySelectorAll('.delete-code-button');

    deleteCodeButtons.forEach(button => {
        button.addEventListener('click', function() {
            // const topLayer = button.parentElement;
            // const codeTextarea = topLayer.nextSibling;
            // const codeBlock = codeTextarea.nextSibling;
            const main = button.parentElement.parentElement;

            const range = document.createRange();
            const selection = window.getSelection();

            range.selectNodeContents(main);

            selection.removeAllRanges();
            selection.addRange(range);

            document.execCommand('delete');
        });
    });
})

document.addEventListener('keydown', function(event) {

    if (event.shiftKey && event.key === 'Enter') {
        event.preventDefault();
    }
});



const codeBlockThemes = [
    "3024-day",
    "3024-night",
    "abbott",
    "abcdef",
    "ambiance",
    "ambiance-mobile",
    "ayu-dark",
    "ayu-mirage",
    "base16-dark",
    "base16-light",
    "bespin",
    "blackboard",
    "cobalt",
    "colorforth",
    "darcula",
    "dracula",
    "duotone-dark",
    "duotone-light",
    "eclipse",
    "elegant",
    "erlang-dark",
    "gruvbox-dark",
    "hopscotch",
    "icecoder",
    "idea",
    "isotope",
    "juejin",
    "lesser-dark",
    "liquibyte",
    "lucario",
    "material",
    "material-darker",
    "material-ocean",
    "material-palenight",
    "mbo",
    "mdn-like",
    "midnight",
    "monokai",
    "moxer",
    "neat",
    "neo",
    "night",
    "nord",
    "oceanic-next",
    "panda-syntax",
    "paraiso-dark",
    "paraiso-light",
    "pastel-on-dark",
    "railscasts",
    "rubyblue",
    "seti",
    "shadowfox",
    "solarized",
    "ssms",
    "the-matrix",
    "tomorrow-night-bright",
    "tomorrow-night-eighties",
    "ttcn",
    "twilight",
    "vibrant-ink",
    "xq-dark",
    "xq-light",
    "yeti",
    "yonce",
    "zenburn"
];

for (let i = 0; i < codeBlockThemes.length; i++) {
    const theme = codeBlockThemes[i];
    const option = document.createElement('button');
    option.onclick = function() {
        localStorage.setItem('code-theme', theme);
        processCodeBlock();
        document.querySelector('.selected-code-block-theme').classList.remove('selected-code-block-theme');
        this.classList.add('selected-code-block-theme');
    }
    option.value = theme;
    option.textContent = theme;
    option.classList.add('code-block-theme-option');
    document.querySelector('.code-block-themes').appendChild(option);
}


function createSettingsCodeBlock(){
    const main = document.createElement('div');
    const createCodeBlock = document.createElement('textarea');
    const createCodeBlockLayer = document.createElement('div');
    createCodeBlockLayer.classList.add('code-block-layer');
    createCodeBlockLayer.setAttribute('contenteditable', false);
    const languageText = document.createElement('p');
    languageText.style.color = '#fff';
    languageText.textContent = 'python';
    createCodeBlockLayer.appendChild(languageText);
    main.appendChild(createCodeBlockLayer);
    createCodeBlock.setAttribute('language', 'python');
    createCodeBlock.setAttribute('name', 'code');
    createCodeBlock.classList.add('code');
    createCodeBlock.value = 
    `# function with two arguments
def add_numbers(num1, num2):
    sum = num1 + num2
    print("Sum: ", sum)
# function call with two values
add_numbers(5, 4)`;
    main.appendChild(createCodeBlock);
    
    document.querySelector('#example-code-block').appendChild(main);

    processCodeBlock();
}

//START PROGRAM
createSettingsCodeBlock();

if(localStorage.getItem('code-theme') === 'null' || !localStorage.getItem('code-theme')){
    localStorage.setItem('code-theme', 'icecoder');
}
