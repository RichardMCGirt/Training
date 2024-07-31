document.addEventListener("DOMContentLoaded", function() {
    populateDropdown();
    shuffleQuestions();
    const selectedSlide = localStorage.getItem('selectedSlide');
    if (selectedSlide) {
        currentSlide = parseInt(selectedSlide, 10) - 2;
        localStorage.removeItem('selectedSlide');
    }
    showSlide(currentSlide);
    setRandomBackgrounds(); // Set random background images on page load
});

let currentSlide = 0;
let selectedElement = null;
const lines = [];
const words = ["storage", "sharing", "recovery", "collaboration"];
let currentWord = words[Math.floor(Math.random() * words.length)];
let attempts = 6;
let guessedLetters = [];
const miniGames = [setupMiniGame1, setupMiniGame2, setupMiniGame3, setupMiniGame4, setupMiniGame5, setupMiniGame6]; // Add more mini-games as needed
const totalQuestions = 25;
let questionOrder = [];
let selectedCards = [];
let matchedPairs = 0;
const allQuestions = [
    { question: "File storage", answer: "Primary use of Dropbox" },
    { question: "File sharing", answer: "Can share files with others" },
    { question: "File recovery", answer: "Allows you to recover deleted files" },
    { question: "Document collaboration", answer: "Dropbox Paper feature" },
    // Add more questions about anything
    { question: "Capital of France", answer: "Paris" },
    { question: "Fastest land animal", answer: "Cheetah" },
    { question: "Largest planet in our solar system", answer: "Jupiter" },
    { question: "H2O is the chemical formula for what?", answer: "Water" },
    { question: "What year did the Titanic sink?", answer: "1912" },
];

// Populate the dropdown with question options
function populateDropdown() {
    const selector = document.getElementById('question-selector');
    for (let i = 1; i <= totalQuestions; i++) {
        const option = document.createElement('option');
        option.value = i + 1;
        option.textContent = `Question ${i}: Mini-Game ${i}`;
        selector.appendChild(option);
    }
}

// Show the current slide
function showSlide(index) {
    const slides = document.querySelectorAll('.slide');
    slides.forEach(slide => slide.classList.remove('active'));
    slides[index].classList.add('active');
    if (miniGames[index - 2]) {
        miniGames[index - 2]();
    }
}

// Go to the selected slide
function goToSlide(index) {
    console.log(`Navigating to slide ${index}`);
    currentSlide = index;
    showSlide(currentSlide);
}

// Restart the slides
function restart() {
    console.log("Restarting the training module");
    currentSlide = 0;
    shuffleQuestions();
    showSlide(currentSlide);
    setRandomBackgrounds(); // Reset background images on restart
    // Reset hangman game
    initializeHangman();
}

// Move to the next slide
function nextSlide() {
    currentSlide++;
    if (currentSlide < totalQuestions) {
        showSlide(currentSlide);
    } else {
        showSlide(totalQuestions); // Show the congratulations slide
    }
    console.log(`Moving to the next slide: ${currentSlide}`);
}

// Shuffle questions for random order
function shuffleQuestions() {
    questionOrder = Array.from({ length: totalQuestions }, (_, i) => i + 2);
    for (let i = questionOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [questionOrder[i], questionOrder[j]] = [questionOrder[j], questionOrder[i]];
    }
    console.log("Shuffled question order:", questionOrder);
}

// Select question from dropdown
function selectQuestion() {
    const selector = document.getElementById('question-selector');
    const slideIndex = parseInt(selector.value, 10) - 1;
    goToSlide(slideIndex);
}

// Reset matching game
function resetMatching() {
    selectedElement = null;
    lines.forEach(({ line }) => line.remove());
    lines.length = 0;
    document.querySelectorAll('.question, .answer').forEach(elem => {
        elem.classList.remove('correct', 'incorrect', 'selected');
    });
    document.getElementById('feedback').textContent = '';
    document.getElementById('next').style.display = 'none';
}

// Memory matching game logic
function setupMemoryGame() {
    console.log("Setting up Memory Matching Game");
    const container = document.getElementById('memory-game-container');
    container.innerHTML = '';
    const cards = createMemoryCards();
    shuffleArray(cards);
    cards.forEach(card => container.appendChild(card));
    matchedPairs = 0;
    selectedCards = [];
}

function createMemoryCards() {
    const questions = allQuestions.slice(0, 4);

    const cards = [];
    questions.forEach((item, index) => {
        const questionCard = document.createElement('div');
        questionCard.className = 'memory-card';
        questionCard.dataset.id = index;
        questionCard.dataset.type = 'question';
        questionCard.innerHTML = `<div class="card-front">?</div><div class="card-back">${item.question}</div>`;
        questionCard.addEventListener('click', handleMemoryCardClick);
        cards.push(questionCard);

        const answerCard = document.createElement('div');
        answerCard.className = 'memory-card';
        answerCard.dataset.id = index;
        answerCard.dataset.type = 'answer';
        answerCard.innerHTML = `<div class="card-front">?</div><div class="card-back">${item.answer}</div>`;
        answerCard.addEventListener('click', handleMemoryCardClick);
        cards.push(answerCard);
    });
    return cards;
}

function handleMemoryCardClick(event) {
    const card = event.currentTarget;
    if (selectedCards.length < 2 && !card.classList.contains('flipped')) {
        card.classList.add('flipped');
        selectedCards.push(card);

        if (selectedCards.length === 2) {
            checkMemoryMatch();
        }
    }
}

function checkMemoryMatch() {
    const [firstCard, secondCard] = selectedCards;
    if (firstCard.dataset.id === secondCard.dataset.id && firstCard.dataset.type !== secondCard.dataset.type) {
        matchedPairs++;
        selectedCards = [];
        if (matchedPairs === 4) {
            document.getElementById('memory-feedback').textContent = 'All correct! Well done!';
            document.getElementById('next').style.display = 'block';
        }
    } else {
        setTimeout(() => {
            firstCard.classList.remove('flipped');
            secondCard.classList.remove('flipped');
            selectedCards = [];
        }, 1000);
    }
}

// Matching game logic (drawing lines)
function setupMatchingGame() {
    console.log("Setting up Line Matching Game");
    const questionsContainer = document.querySelector('.questions');
    const answersContainer = document.querySelector('.answers');
    const questions = Array.from(questionsContainer.children);
    const answers = Array.from(answersContainer.children);

    shuffleArray(questions);
    shuffleArray(answers);

    questionsContainer.innerHTML = '';
    answersContainer.innerHTML = '';

    questions.forEach(question => questionsContainer.appendChild(question));
    answers.forEach(answer => answersContainer.appendChild(answer));

    document.querySelectorAll('.question, .answer').forEach(element => {
        element.addEventListener('click', () => {
            if (selectedElement) {
                selectedElement.classList.remove('selected');
            }
            selectedElement = element;
            selectedElement.classList.add('selected');
        });
    });

    document.querySelectorAll('.question, .answer').forEach(element => {
        element.addEventListener('click', () => {
            if (selectedElement) {
                const svg = document.getElementById('svg');
                const selectedRect = selectedElement.getBoundingClientRect();
                const elementRect = element.getBoundingClientRect();
                const selectedCenterX = selectedRect.left + selectedRect.width / 2;
                const selectedCenterY = selectedRect.top + selectedRect.height / 2;
                const elementCenterX = elementRect.left + elementRect.width / 2;
                const elementCenterY = elementRect.top + elementRect.height / 2;

                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', selectedCenterX);
                line.setAttribute('y1', selectedCenterY);
                line.setAttribute('x2', elementCenterX);
                line.setAttribute('y2', elementCenterY);
                line.setAttribute('stroke', 'black');
                line.setAttribute('stroke-width', '2');

                svg.appendChild(line);
                lines.push({ selected: selectedElement, element, line });

                // Immediate feedback
                if (selectedElement.getAttribute('data-id') === element.getAttribute('data-id')) {
                    selectedElement.classList.add('correct');
                    element.classList.add('correct');
                } else {
                    selectedElement.classList.add('incorrect');
                    element.classList.add('incorrect');
                    setTimeout(() => line.remove(), 1000);
                }

                selectedElement.classList.remove('selected');
                selectedElement = null;
            }
        });
    });
}

function checkMatching() {
    const feedback = document.getElementById('feedback');
    let correct = 0;

    lines.forEach(({ selected, element }) => {
        if (selected.getAttribute('data-id') === element.getAttribute('data-id')) {
            correct += 1;
        }
    });

    if (correct === lines.length) {
        feedback.textContent = 'All correct! Well done! Proceed to the next question?';
        feedback.classList.add('correct');
        feedback.classList.remove('incorrect');
        document.getElementById('next').style.display = 'block';
    } else {
        feedback.textContent = `You got ${correct} out of ${lines.length} correct.`;
        feedback.classList.add('incorrect');
        feedback.classList.remove('correct');
    }

    console.log("Matching game feedback:", feedback.textContent);
}

// Hangman game logic
function initializeHangman() {
    console.log("Initializing Hangman game");
    currentWord = words[Math.floor(Math.random() * words.length)];
    attempts = 6;
    guessedLetters = [];
    drawHangman();
}

function drawHangman() {
    const container = document.getElementById('hangman-container');
    const wordDisplay = currentWord.split('').map(letter => guessedLetters.includes(letter) ? letter : '_').join(' ');
    const guessedLettersDisplay = guessedLetters.join(', ');
    container.innerHTML = `
        <p>${wordDisplay}</p>
        <div class="hangman">
            <div class="gallows"></div>
            <div class="head" style="visibility:${attempts <= 5 ? 'visible' : 'hidden'}"></div>
            <div class="body" style="visibility:${attempts <= 4 ? 'visible' : 'hidden'}"></div>
            <div class="left-arm" style="visibility:${attempts <= 3 ? 'visible' : 'hidden'}"></div>
            <div class="right-arm" style="visibility:${attempts <= 2 ? 'visible' : 'hidden'}"></div>
            <div class="left-leg" style="visibility:${attempts <= 1 ? 'visible' : 'hidden'}"></div>
            <div class="right-leg" style="visibility:${attempts <= 0 ? 'visible' : 'hidden'}"></div>
        </div>
        <p>Guessed letters: ${guessedLettersDisplay}</p>
    `;
    console.log("Hangman display updated");
}

function makeGuess() {
    const input = document.getElementById('guess-input');
    const feedback = document.getElementById('hangman-feedback');
    const guess = input.value.toLowerCase();

    if (!guess || guess.length !== 1) {
        feedback.textContent = "Please enter a single letter.";
        feedback.classList.add('incorrect');
        return;
    }

    if (guessedLetters.includes(guess)) {
        feedback.textContent = "You already guessed that letter.";
        feedback.classList.add('incorrect');
        return;
    }

    guessedLetters.push(guess);
    input.value = '';

    if (currentWord.includes(guess)) {
        feedback.textContent = "Correct!";
        feedback.classList.add('correct');
        feedback.classList.remove('incorrect');
    } else {
        attempts -= 1;
        feedback.textContent = `Incorrect! Attempts left: ${attempts}`;
        feedback.classList.add('incorrect');
        feedback.classList.remove('correct');
    }

    drawHangman();

    if (attempts === 0) {
        feedback.textContent = `Game Over! The word was: ${currentWord}`;
        document.getElementById('next').style.display = 'block';
    } else if (!document.getElementById('hangman-container').textContent.includes('_')) {
        feedback.textContent = "Congratulations! You've guessed the word!";
        document.getElementById('next').style.display = 'block';
    }
    console.log("Guess made:", guess);
}

// Additional mini-games inspired by the suggested site
function setupMiniGame1() {
    // Example game: True or False
    const container = document.getElementById('mini-game-1-container');
    container.innerHTML = `
        <p>Dropbox allows file sharing?</p>
        <button onclick="checkAnswer(true, true)">True</button>
        <button onclick="checkAnswer(false, true)">False</button>
    `;
}

function setupMiniGame2() {
    // Example game: Quiz
    const container = document.getElementById('mini-game-2-container');
    container.innerHTML = `
        <p>Which feature allows collaboration in Dropbox?</p>
        <button onclick="checkAnswer('Dropbox Paper', 'Dropbox Paper')">Dropbox Paper</button>
        <button onclick="checkAnswer('File sharing', 'Dropbox Paper')">File sharing</button>
    `;
}

function setupMiniGame3() {
    // Example game: Multiple Choice
    const container = document.getElementById('mini-game-3-container');
    container.innerHTML = `
        <p>What is the capital of France?</p>
        <button onclick="checkAnswer('Paris', 'Paris')">Paris</button>
        <button onclick="checkAnswer('London', 'Paris')">London</button>
        <button onclick="checkAnswer('Rome', 'Paris')">Rome</button>
        <button onclick="checkAnswer('Berlin', 'Paris')">Berlin</button>
    `;
}

function setupMiniGame4() {
    // Example game: Multiple Choice
    const container = document.getElementById('mini-game-4-container');
    container.innerHTML = `
        <p>Which is the largest planet in our solar system?</p>
        <button onclick="checkAnswer('Jupiter', 'Jupiter')">Jupiter</button>
        <button onclick="checkAnswer('Saturn', 'Jupiter')">Saturn</button>
        <button onclick="checkAnswer('Earth', 'Jupiter')">Earth</button>
        <button onclick="checkAnswer('Mars', 'Jupiter')">Mars</button>
    `;
}

function setupMiniGame5() {
    // Example game: Quiz
    const container = document.getElementById('mini-game-5-container');
    container.innerHTML = `
        <p>What is the fastest land animal?</p>
        <button onclick="checkAnswer('Cheetah', 'Cheetah')">Cheetah</button>
        <button onclick="checkAnswer('Lion', 'Cheetah')">Lion</button>
        <button onclick="checkAnswer('Tiger', 'Cheetah')">Tiger</button>
        <button onclick="checkAnswer('Leopard', 'Cheetah')">Leopard</button>
    `;
}

function setupMiniGame6() {
    // Example game: True or False
    const container = document.getElementById('mini-game-6-container');
    container.innerHTML = `
        <p>Is Jupiter the largest planet in our solar system?</p>
        <button onclick="checkAnswer(true, true)">True</button>
        <button onclick="checkAnswer(false, true)">False</button>
    `;
}

function checkAnswer(selectedAnswer, correctAnswer) {
    const feedback = document.getElementById(`mini-game-feedback`);
    if (selectedAnswer === correctAnswer) {
        feedback.textContent = "Correct!";
        feedback.classList.add('correct');
        feedback.classList.remove('incorrect');
    } else {
        feedback.textContent = "Incorrect!";
        feedback.classList.add('incorrect');
        feedback.classList.remove('correct');
    }
    document.getElementById('next').style.display = 'block';
    console.log(`Answer checked: selectedAnswer=${selectedAnswer}, correctAnswer=${correctAnswer}`);
}

// Utility function to shuffle array
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

async function setRandomBackgrounds() {
    const slides = document.querySelectorAll('.slide');
    for (const slide of slides) {
        try {
            const response = await fetch('https://dog.ceo/api/breeds/image/random');
            const data = await response.json();
            const imgUrl = data.message;
            
            // Create a new image element to use with Vibrant
            const img = new Image();
            img.crossOrigin = 'Anonymous'; // Handle CORS issues
            img.src = imgUrl;

            img.onload = () => {
                // Set background image
                slide.style.backgroundImage = `url(${imgUrl})`;
                slide.style.backgroundSize = 'cover';
                slide.style.backgroundPosition = 'center';

                // Create a new Vibrant instance
                Vibrant.from(img).getPalette((err, palette) => {
                    if (err) {
                        console.error('Error getting palette:', err);
                        return;
                    }

                    const lightVibrant = palette.lightVibrant || palette.vibrant;
                    const textColor = getContrastingColor(lightVibrant.getHex());

                    // Adjust styles based on dominant color
                    slide.querySelectorAll('h1, p, button, .question, .answer, .feedback').forEach(element => {
                        element.style.color = textColor;
                        if (element.tagName === 'BUTTON') {
                            element.style.backgroundColor = textColor === 'black' ? 'white' : 'rgba(0, 0, 0, 0.7)';
                            element.style.border = `1px solid ${textColor}`;
                        }
                    });
                    console.log('Background image set for slide:', slide.id);
                });
            };
        } catch (error) {
            console.error('Error fetching dog image:', error);
        }
    }
}

// Utility function to get contrasting color (black or white)
function getContrastingColor(hex) {
    const rgb = parseInt(hex.slice(1), 16); // Convert hex to RGB
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >>  8) & 0xff;
    const b = (rgb >>  0) & 0xff;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128 ? 'black' : 'white';
}
