document.addEventListener('DOMContentLoaded', function() {
    const pianoContainer = document.getElementById('piano');
    const staffCanvas = document.getElementById('staffCanvas');
    const staffCtx = staffCanvas.getContext('2d');
    const clearBtn = document.getElementById('clearBtn'); // clear button
    let playedNotes = []; // Массив для сохранения сыгранных нот

    // Увеличиваем ширину канваса для удлинения нотного стана
    staffCanvas.width = 2000;  // Увеличиваем длину для длинного нотного стана
    staffCanvas.height = 500;  // Увеличиваем высоту канваса для всех октав

    // Определяем клавиши и ноты
    const keys = [
        'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
    ];

    
    // Функция для создания элемента клавиши
    function createKey(note, isBlack, position, blackPosition) {
        const key = document.createElement('div');
        key.className = `key ${isBlack ? 'black' : 'white'}`;
        key.dataset.note = note; // Привязка ноты к клавише
        if (isBlack) {
            key.style.left = `${blackPosition}px`; // Позиция черной клавиши
        } else {
            key.style.left = `${position}px`; // Позиция белой клавиши
        }
        return key;
    }

    
    function highlightKey(keyElement) {
        keyElement.classList.add('active');
        setTimeout(() => keyElement.classList.remove('active'), 200);
    }
    function highlightKey(keyElement) {
        keyElement.classList.add('active');
        setTimeout(() => keyElement.classList.remove('active'), 200);
    }
    
    // Добавляем обработчик событий для нажатий клавиш на клавиатуре
    document.addEventListener('keydown', function(event) {
    const note = keyboardMapping[event.key.toLowerCase()];
    
    if (note) {  // Если нажатая клавиша есть в маппинге, играем соответствующую ноту
        playedNotes.push(note);  // Добавляем ноту в массив
        updateStaff();  // Обновляем нотный стан со всеми сыгранными нотами
        playNoteSound(note);  // Проигрываем звук ноты
        
        // Найдем соответствующую клавишу на пианино и подсветим ее
        const keyElement = document.querySelector(`.key[data-note="${note}"]`);
        if (keyElement) {
            keyElement.style.backgroundColor = '#ddd'; // Подсветим нажатую клавишу
            setTimeout(() => {
                keyElement.style.backgroundColor = keyElement.classList.contains('black') ? '#000' : '#fff';
            }, 200);  // Возвращаем цвет через 200 мс
        }
    }
});
    // Функция для рисования нотного стана
    function drawStaff() {
        staffCtx.clearRect(0, 0, staffCanvas.width, staffCanvas.height);
        staffCtx.strokeStyle = 'black';
        staffCtx.lineWidth = 2;

        // Рисуем 5 линий нотного стана
        for (let i = 0; i < 5; i++) {
            staffCtx.beginPath();
            staffCtx.moveTo(20, 200 + i * 20);  // Сместили нотный стан немного ниже
            staffCtx.lineTo(staffCanvas.width - 20, 200 + i * 20);  // Увеличили длину линий стана
            staffCtx.stroke();
        }

        drawTrebleClef();  // Рисуем скрипичный ключ
        drawEndBars();     // Рисуем две полоски в конце нотного стана
    }

    // Функция для рисования скрипичного ключа в начале нотного стана
    function drawTrebleClef() {
        const trebleClefImage = new Image();
        // trebleClefImage.src = 'Key.png';  // Заменить на путь к изображению скрипичного ключа
        trebleClefImage.onload = function() {
            staffCtx.drawImage(trebleClefImage, 10, 180, 40, 100);  // Позиция и размер скрипичного ключа
        };
    }

    // Добавляем функционал для кнопки Clear
    clearBtn.addEventListener('click', function() {
        playedNotes = [];  // Очищаем массив сыгранных нот
        drawStaff();  // Очищаем нотный стан
    });

    // Добавляем функционал для кнопки Undo
    undoBtn.addEventListener('click', function() {
        if (playedNotes.length > 0) {
            playedNotes.pop();  // Удаляем последнюю ноту
            updateStaff();  // Перерисовываем нотный стан без последней ноты
        }
    });

    // Функция для рисования двух вертикальных полос в конце нотного стана
    function drawEndBars() {
        const endPosition = staffCanvas.width - 40; 
        // Первая линия (тонкая)
        staffCtx.beginPath();
        staffCtx.moveTo(endPosition + 10, 200);
        staffCtx.lineTo(endPosition + 10, 280);
        staffCtx.lineWidth = 2;
        staffCtx.stroke();

        // Вторая линия (толстая)
        staffCtx.beginPath();
        staffCtx.moveTo(endPosition + 20, 200);  // Смещаем вторую линию немного вправо
        staffCtx.lineTo(endPosition + 20, 280);
        staffCtx.lineWidth = 4;
        staffCtx.stroke();

        staffCtx.font = '100px Bravura';  // Используем музыкальный шрифт Bravura
        staffCtx.fillText('\uD834\uDD1E', 25, 275);  // Unicode для скрипичного ключа (𝄞), оставляем на месте
    }
    

    // Функция для рисования дополнительных линий для нот вне нотного стана
    function drawAdditionalLines(yPos, xPosition) {
        staffCtx.strokeStyle = 'black';
        staffCtx.lineWidth = 2;

        // Если нота ниже нотного стана
        if (yPos > 290) {
            let linePos = 300; // Рисуем линии ниже нотного стана
            while (linePos <= yPos) {
                staffCtx.beginPath();
                staffCtx.moveTo(xPosition - 15, linePos);  // Рисуем линию перед нотой
                staffCtx.lineTo(xPosition + 15, linePos);
                staffCtx.stroke();
                linePos += 20;
            }
        }

        // Если нота выше нотного стана
        if (yPos < 200) {
            let linePos = 200; // Рисуем линии выше нотного стана
            while (linePos >= yPos) {
                staffCtx.beginPath();
                staffCtx.moveTo(xPosition - 15, linePos);  // Рисуем линию перед нотой
                staffCtx.lineTo(xPosition + 15, linePos); 
                staffCtx.stroke();
                linePos -= 20;
            }
        }
    }

    // Функция для отображения ноты на нотном стане
    function drawNoteOnStaff(note, xPosition) {
        const notePositions = {
            // Малая октава (ниже нотного стана)
            'C1': 370,  
            'D1': 360,  
            'E1': 350,  
            'F1': 340,  
            'G1': 330,  
            'A1': 320,  
            // 'Ab1': 330,
            'B1': 310,  

            // Первая октава (на нотном стане)
            'C2': 300,  
            'D2': 290,  
            'E2': 280,  
            'F2': 270,  
            'G2': 260,  
            'A2': 250,  
            'B2': 240,  

            // Вторая октава
            'C3': 230,
            'D3': 220,
            'E3': 210,
            'F3': 200,
            'G3': 190,
            'A3': 180,
            'B3': 170,

            // Третья октава (выше нотного стана)
            'C4': 160,
            'D4': 150,
            'E4': 140,
            'F4': 130,
            'G4': 120,
            'A4': 110,
            'B4': 100,
        };
           
        const yPos = notePositions[note.replace('#', '').replace('b', '')] || 150;

        // drawStaff();
        drawAdditionalLines(yPos, xPosition);  // Рисуем дополнительные линии для нот, если необходимо

        // Проверяем, есть ли диез или бемоль
        let accidental = null;
        if (note.includes('#')) {
            accidental = '\u266F'; // Диез
        } else if (note.includes('b')) {
            accidental = '♭'; // Бемоль
        }

        // Рисуем диез или бемоль, если есть
        if (accidental) {
            staffCtx.font = '26px Arial';  // Более крупный и аккуратный диез
            staffCtx.fillStyle = 'black';  // Цвет для диеза
            staffCtx.fillText(accidental, xPosition - 20, yPos + 6); // Добавляем символ перед нотой
        }

        // Рисуем ноту
        staffCtx.beginPath();
        staffCtx.arc(xPosition ,yPos, 8, 0, 2 * Math.PI);  // Отображение ноты в виде круга
        staffCtx.fillStyle = 'black';
        staffCtx.fill();
    }
    function playNoteSound(note) {
        // const liveRegion = document.getElementById('live-region');
        // liveRegion.textContent = `Playing note ${note}`;
        const noteFiles = {
            'A#1': 'Ad1.mp3',
            'A1': 'A1.mp3',
            'B1': 'B1.mp3',
            'C#1': 'Cd1.mp3',
            'C1': 'C1.mp3',
            'D#1': 'Dd1.mp3',
            'D1': 'D1.mp3',
            'E1': 'E1.mp3',
            'F#1': 'Fd1.mp3',
            'F1': 'F1.mp3',
            'G#1': 'Gd1.mp3',
            'G1': 'G1.mp3',
    
            'A#2': 'Ad2.mp3',
            'A2': 'A2.mp3',
            'B2': 'B2.mp3',
            'C#2': 'Cd2.mp3',
            'C2': 'C2.mp3',
            'D#2': 'Dd2.mp3',
            'D2': 'D2.mp3',
            'E2': 'E2.mp3',
            'F#2': 'Fd2.mp3',
            'F2': 'F2.mp3',
            'G#2': 'Gd2.mp3',
            'G2': 'G2.mp3',
    
            'A#3': 'Ad3.mp3',
            'A3': 'A3.mp3',
            'B3': 'B3.mp3',
            'C#3': 'Cd3.mp3',
            'C3': 'C3.mp3',
            'D#3': 'Dd3.mp3',
            'D3': 'D3.mp3',
            'E3': 'E3.mp3',
            'F#3': 'Fd3.mp3',
            'F3': 'F3.mp3',
            'G#3': 'Gd3.mp3',
            'G3': 'G3.mp3',
    
            'A#4': 'Ad4.mp3',
            'A4': 'A4.mp3',
            'B4': 'B4.mp3',
            'C#4': 'Cd4.mp3',
            'C4': 'C4.mp3',
            'D#4': 'Dd4.mp3',
            'D4': 'D4.mp3',
            'E4': 'E4.mp3',
            'F#4': 'Fd4.mp3',
            'F4': 'F4.mp3',
            'G#4': 'Gd4.mp3',
            'G4': 'G4.mp3'
        };
    
        const audioPath = `sounds/${noteFiles[note]}`;
        
        if (noteFiles[note]) {
            const audio = new Audio(audioPath);
            audio.play().then(() => {
                console.log(`Воспроизведение звука: ${note}`);
            }).catch((error) => {
                console.error(`Ошибка при воспроизведении звука: ${error}`);
            });
        } else {
            console.error('Звук для этой ноты не найден:', note);
        }
    }

    // Добавляем функционал для кнопки Clear
    clearBtn.addEventListener('click', function() {
        playedNotes = [];  // Очищаем массив сыгранных нот
        drawStaff();  // Очищаем нотный стан
    });

    // Создаем клавиши для 4 октав
    function createPiano() {
        const octaves = 4; // Количество октав
        let position = 0;
        let blackPosition = 0;

        for (let octave = 0; octave < octaves; octave++) {
            keys.forEach((key, index) => {
                if (key.includes('#')) {
                    if (index === 1 || index === 6 || index === 8) {
                        blackPosition += 30;
                    }
                    pianoContainer.appendChild(createKey(key + (octave + 1), true, position + 20, blackPosition));
                    blackPosition += 30;
                } else {
                    pianoContainer.appendChild(createKey(key + (octave + 1), false, position, blackPosition));
                    position += 30;
                }
            });
        }
    }


    
    // Функция для обновления нотного стана с отображением всех нот
    function updateStaff() {
        drawStaff();  // Перерисовываем нотный стан
        let xPosition = 120;  // Начальная позиция для отображения первой ноты
        const noteSpacing = 60; // Интервал между нотами
    
        playedNotes.forEach(note => {
            // Проверяем, если нота выйдет за пределы канваса
            if (xPosition + noteSpacing > staffCanvas.width - 10) {
                console.log('Нотный стан закончился, нота не может быть напечатана.');
                return;  // Прерываем цикл, чтобы не печатать ноты за пределами стана
            }
            drawNoteOnStaff(note, xPosition);
            xPosition += noteSpacing;  // Смещаем позицию для следующей ноты
        });
    }

    // Добавляем обработчики событий для нажатия клавиш
    function addKeyListeners() {
        const allKeys = document.querySelectorAll('.key');
        allKeys.forEach(key => {
            key.addEventListener('mousedown', function() {
                const note = this.dataset.note;
                playedNotes.push(note);  // Добавляем ноту в массив
                updateStaff();  // Обновляем нотный стан со всеми сыгранными нотами
                playNoteSound(note);
                this.style.backgroundColor = '#ddd'; // Светлый цвет при нажатии
            });
            key.addEventListener('mouseup', function() {
                this.style.backgroundColor = this.classList.contains('black') ? '#000' : '#fff';
            });
            key.addEventListener('mouseleave', function() {
                this.style.backgroundColor = this.classList.contains('black') ? '#000' : '#fff';
            });
        });
    }


// Обновим обработчики событий для клавиш
function addKeyListeners() {
    const allKeys = document.querySelectorAll('.key');
    allKeys.forEach(key => {
        // Обработчики для мыши
        key.addEventListener('mousedown', function(event) {
            playNote(this.dataset.note);
        });
        key.addEventListener('mouseup', function() {
            resetKeyColor(this);
        });
        key.addEventListener('mouseleave', function() {
            resetKeyColor(this);
        });

        // Обработчики для сенсорных устройств
        key.addEventListener('touchstart', function(event) {
            event.preventDefault(); // Предотвращаем скролл и другие действия по умолчанию
            playNote(this.dataset.note);
        }, { passive: false });
        key.addEventListener('touchend', function() {
            resetKeyColor(this);
        });
    });
}

// Функция для воспроизведения ноты и изменения цвета клавиши
function playNote(note) {
    console.log(`Playing note: ${note}`);
    playedNotes.push(note); // Добавляем ноту в массив
    updateStaff(); // Обновляем нотный стан со всеми сыгранными нотами
    playNoteSound(note); // Воспроизводим звук ноты

    const keyElement = document.querySelector(`.key[data-note="${note}"]`);
    if (keyElement) {
        keyElement.style.backgroundColor = '#ddd'; // Подсветка клавиши при игре
    }
}

// Функция для сброса цвета клавиши
function resetKeyColor(keyElement) {
    keyElement.style.backgroundColor = keyElement.classList.contains('black') ? '#000' : '#fff';
}


    createPiano();
    addKeyListeners();
    drawStaff();  // Отрисовка начального нотного стана
});
