let currentSlide = 0;
let selectedQuestion = null;
const lines = [];

function showSlide(index) {
    const slides = document.querySelectorAll('.slide');
    slides.forEach(slide => slide.classList.remove('active'));
    slides[index].classList.add('active');
}

function nextSlide() {
    const slides = document.querySelectorAll('.slide');
    currentSlide = (currentSlide + 1) % slides.length;
    showSlide(currentSlide);
}

function prevSlide() {
    const slides = document.querySelectorAll('.slide');
    currentSlide = (currentSlide - 1 + slides.length) % slides.length;
    showSlide(currentSlide);
}

function restart() {
    currentSlide = 0;
    showSlide(currentSlide);
}

document.querySelectorAll('.question').forEach(question => {
    question.addEventListener('click', () => {
        selectedQuestion = question;
        selectedQuestion.classList.add('selected');
    });
});

document.querySelectorAll('.answer').forEach(answer => {
    answer.addEventListener('click', () => {
        if (selectedQuestion) {
            const svg = document.getElementById('svg');
            const qRect = selectedQuestion.getBoundingClientRect();
            const aRect = answer.getBoundingClientRect();
            const qCenterX = qRect.left + qRect.width / 2;
            const qCenterY = qRect.top + qRect.height / 2;
            const aCenterX = aRect.left + aRect.width / 2;
            const aCenterY = aRect.top + aRect.height / 2;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', qCenterX);
            line.setAttribute('y1', qCenterY);
            line.setAttribute('x2', aCenterX);
            line.setAttribute('y2', aCenterY);
            line.setAttribute('stroke', 'black');
            line.setAttribute('stroke-width', '2');

            svg.appendChild(line);
            lines.push({ question: selectedQuestion, answer, line });

            selectedQuestion.classList.remove('selected');
            selectedQuestion = null;
        }
    });
});

function checkMatching() {
    const feedback = document.getElementById('feedback');
    let correct = 0;

    lines.forEach(({ question, answer }) => {
        if (question.getAttribute('data-id') === answer.getAttribute('data-id')) {
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
}

// Initialize the first slide
showSlide(currentSlide);
