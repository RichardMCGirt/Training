document.addEventListener("DOMContentLoaded", function() {
    const buttonContainer = document.getElementById('button-container');
    for (let i = 0; i < 23; i++) {
        const button = document.createElement('button');
        button.innerHTML = `Question ${3 + i}: Mini-Game ${i + 1}`;
        button.setAttribute('onclick', `goToSlide(${4 + i})`);
        buttonContainer.appendChild(button);
    }
    shuffleQuestions();
    showSlide(questionOrder[currentSlide]);
    setRandomBackgrounds(); // Set random background images on page load
});

let currentSlide = 0;
let selectedElement = null;
const lines = [];
const words = ["storage", "sharing", "recovery", "collaboration"];
let currentWord = words[Math.floor(Math.random() * words.length)];
let attempts = 6;
let guessedLetters = [];
const miniGames = [];
const totalQuestions = 25;
let questionOrder = [];

// Show the current slide
function showSlide(index) {
    const slides = document.querySelectorAll('.slide');
    slides.forEach(slide => slide.classList.remove('active'));
    slides[index].classList.add('active');
    if (miniGames[index]) {
        miniGames[index]();
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
    showSlide(questionOrder[currentSlide]);
    setRandomBackgrounds(); // Reset background images on restart
    // Reset hangman game
    initializeHangman();
}

// Move to the next slide
function nextSlide() {
    currentSlide++;
    if (currentSlide < totalQuestions) {
        showSlide(questionOrder[currentSlide]);
    } else {
        showSlide(totalQuestions + 1); // Show the congratulations slide
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

// Matching game logic
function setupMatchingGame() {
    console.log("Setting up Matching Game");
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
        feedback.textContent = 'All correct!';
        feedback.classList.add('correct');
        feedback.classList.remove('incorrect');
    } else {
        feedback.textContent = `You got ${correct} out of ${lines.length} correct.`;
        feedback.classList.add('incorrect');
        feedback.classList.remove('correct');
    }

    document.getElementById('next').style.display = 'block';
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
        <button onclick="checkAnswer(true, 1)">True</button>
        <button onclick="checkAnswer(false, 1)">False</button>
    `;
}

function setupMiniGame2() {
    // Example game: Quiz
    const container = document.getElementById('mini-game-2-container');
    container.innerHTML = `
        <p>Which feature allows collaboration in Dropbox?</p>
        <button onclick="checkAnswer(true, 2)">Dropbox Paper</button>
        <button onclick="checkAnswer(false, 2)">File sharing</button>
    `;
}

function checkAnswer(answer, gameId) {
    const feedback = document.getElementById(`mini-game-${gameId}-feedback`);
    if (answer) {
        feedback.textContent = "Correct!";
        feedback.classList.add('correct');
        feedback.classList.remove('incorrect');
    } else {
        feedback.textContent = "Incorrect!";
        feedback.classList.add('incorrect');
        feedback.classList.remove('correct');
    }
    document.getElementById('next').style.display = 'block';
    console.log(`Mini-Game ${gameId} answer checked:`, answer);
}

// Utility function to shuffle array
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// Function to set random background images
async function setRandomBackgrounds() {
    const slides = document.querySelectorAll('.slide');
    for (const slide of slides) {
        try {
            const response = await fetch('https://dog.ceo/api/breeds/image/random');
            const data = await response.json();
            slide.style.backgroundImage = `url(${data.message})`;
            slide.style.backgroundSize = 'cover';
            slide.style.backgroundPosition = 'center';
            console.log('Background image set for slide:', slide.id);
        } catch (error) {
            console.error('Error fetching dog image:', error);
        }
    }
}
