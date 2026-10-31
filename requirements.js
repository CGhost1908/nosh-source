const { google } = require("googleapis");
const { read } = require("original-fs");
const fsPromises = require('fs').promises;
const { create } = require('domain');
const { ipcRenderer, dialog } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { text } = require('stream/consumers');
const axios = require('axios');
const { shell } = require('electron');


//Code Mirror
const CodeMirror = require('codemirror');
const { basicSetup } = require("@codemirror/basic-setup");
const { autocompletion } = require("@codemirror/autocomplete");
require('codemirror/lib/codemirror');
require('codemirror/addon/edit/closebrackets');
require('codemirror/addon/hint/show-hint');


//C C++ Java
require('codemirror/mode/clike/clike');

// JavaScript
require('codemirror/mode/javascript/javascript');
require('codemirror/addon/hint/javascript-hint');

// HTML
require('codemirror/mode/htmlmixed/htmlmixed');
require('codemirror/mode/xml/xml');  
require('codemirror/addon/hint/html-hint');

// CSS
require('codemirror/mode/css/css');
require('codemirror/addon/hint/css-hint');

// Python 
require('codemirror/mode/python/python');

// PHP 
require('codemirror/mode/php/php');

// Ruby 
require('codemirror/mode/ruby/ruby');

// Another Languages
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

// Autocomplete
require('codemirror/addon/hint/show-hint');
require('codemirror/addon/hint/javascript-hint');
require('codemirror/addon/hint/html-hint');
require('codemirror/addon/hint/css-hint');
require('codemirror/keymap/sublime.js');

const port = 2222;
let savesDir;

//spotify
const spotifyClientSecret = '';
const spotifyClientId = '';

//github
const githubToken = '';
const repoOwner = 'cghost1908';
const repoName = 'nosh';

//global variables

//Content
const textTitle = document.querySelector('.text-title');

const home = `
    <h1>Version 1.3 Alpha Test Version</h1>
    <img width="400px" src="src/drive.png">
    <h2>Google Drive is now ready for testing!</h3>
    <h3>You can connect your Google Drive account to Nosh and sync your files easily. This is a test version, so please try it out and share your feedback. Your thoughts will help us make it better!</h3>
    <h3>Thank you for using Nosh!</h3>
    <br>
    <h2>1.3.1 Patch</h3>
    <h3>🔎 Fixed search.</h3>
    <br>
    <h1>1.3.2 Patch</h1>
    <h3>🚀 Now you can <span style="color: #894FDCFF; font-size: inherit;">publish</span> your files on the <span style="color: #894FDCFF; font-size: inherit;">web</span>.</h3>
    <h3>🎨 Enjoy the all-new, reimagined Settings UI.</h3>
`;

content.innerHTML = home;
textTitle.textContent = 'Home';

if(localStorage.getItem('code-theme') === null) {
    localStorage.setItem('code-theme', 'darcula');
}