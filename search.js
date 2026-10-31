

const searchInput = document.querySelector('.search-input');
searchInput.addEventListener('input', function() {
    const saves = document.querySelectorAll('.saves .save');
    const searchTerm = searchInput.value.toLowerCase();
    saves.forEach(save => {
        const text = save.textContent.toLowerCase();
        console.log(text);
        if(text.includes(searchTerm)){
            save.classList.remove('hidden');
        }else{
            save.classList.add('hidden');
        }
    });
});