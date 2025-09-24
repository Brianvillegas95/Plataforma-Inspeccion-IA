// Archivo: chatbot.js (Versión con botón "Atrás" e historial de navegación)

document.addEventListener('DOMContentLoaded', () => {
    // --- Elementos del DOM ---
    const chatBubble = document.getElementById('chat-bubble');
    const chatContainer = document.getElementById('chat-container');
    const closeChat = document.getElementById('close-chat');
    const messagesContainer = document.getElementById('chat-messages');
    const optionsContainer = document.getElementById('chat-options');

    // --- Elementos para el Lightbox (imagen en pantalla completa) ---
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxClose = document.querySelector('.lightbox-close');

    if (!chatBubble || !chatContainer || !closeChat || !messagesContainer || !optionsContainer || !lightbox || !lightboxImg || !lightboxClose) {
        console.error("No se encontraron los elementos necesarios para el chatbot o el lightbox. Revisa el HTML.");
        return;
    }

    let isChatInitiated = false;
    // NUEVO: Pila para guardar el historial de navegación del usuario.
    let historyStack = [];

    // --- ABRIR Y CERRAR EL CHAT ---
    chatBubble.addEventListener('click', () => {
        chatContainer.classList.toggle('open');
        if (!isChatInitiated && chatContainer.classList.contains('open')) {
            const welcomeMessage = "¡Hola! Soy Quali, tu asistente de calidad. Puedo ayudarte a resolver las dudas más frecuentes. Para empezar, selecciona el área que deseas consultar.";
            showBotMessage(welcomeMessage);
            // MODIFICADO: Reiniciamos el historial al iniciar una nueva conversación.
            historyStack = ['0'];
            getNextDialogue('0');
            isChatInitiated = true;
        }
    });

    closeChat.addEventListener('click', () => {
        chatContainer.classList.remove('open');
    });

    // --- LÓGICA DEL LIGHTBOX (IMAGEN GRANDE) ---
    lightboxClose.addEventListener('click', () => lightbox.style.display = 'none');
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            lightbox.style.display = 'none';
        }
    });

    // --- MANEJO DE LA INTERACCIÓN DEL USUARIO ---
    function handleOptionClick(option) {
        const userMessageElement = document.createElement('div');
        userMessageElement.classList.add('user-message');
        userMessageElement.textContent = option.text;
        messagesContainer.appendChild(userMessageElement);

        optionsContainer.querySelectorAll('.option-button').forEach(button => {
            button.disabled = true;
        });

        // MODIFICADO: Actualizamos el historial antes de navegar.
        if (option.nextId === '0') {
            // Si la opción es "Volver al inicio", reiniciamos el historial.
            historyStack = ['0'];
        } else {
            // Si es cualquier otra opción, la añadimos al historial.
            historyStack.push(option.nextId);
        }

        getNextDialogue(option.nextId);
    }

    // NUEVO: Función para manejar la lógica de retroceso.
    function goBack() {
        if (historyStack.length > 1) {
            historyStack.pop(); // Quitamos el paso actual del historial.
            const previousId = historyStack[historyStack.length - 1]; // Obtenemos el ID anterior.
            // Llamamos a getNextDialogue directamente para no modificar el historial de nuevo.
            getNextDialogue(previousId);
        }
    }

    // --- FUNCIÓN CENTRAL PARA MOSTRAR MENSAJES DEL BOT ---
    function showBotMessage(text, mediaUrl = null) {
        // (Esta función permanece sin cambios, es la de la respuesta anterior)
        const botMessageElement = document.createElement('div');
        botMessageElement.classList.add('bot-message');

        const formattedText = text.replace(/\/\//g, '<br><br>');
        botMessageElement.innerHTML = formattedText;

        if (mediaUrl) {
            let mediaElement;
            const mediaUrlLower = mediaUrl.toLowerCase();

            if (mediaUrlLower.endsWith('.pdf')) {
                mediaElement = document.createElement('a');
                mediaElement.href = mediaUrl;
                mediaElement.target = '_blank';
                mediaElement.rel = 'noopener noreferrer';
                mediaElement.textContent = '📄 Ver Documento (PDF)';
                mediaElement.classList.add('chat-media-link');
            } else if (mediaUrlLower.endsWith('.mp4')) {
                mediaElement = document.createElement('video');
                mediaElement.src = mediaUrl;
                mediaElement.controls = true;
                mediaElement.muted = true;
                mediaElement.autoplay = true;
                mediaElement.playsInline = true;
                mediaElement.style.width = '100%';
                mediaElement.style.borderRadius = '10px';
                mediaElement.style.marginTop = '10px';
            } else {
                mediaElement = document.createElement('img');
                mediaElement.src = mediaUrl;
                mediaElement.classList.add('chat-media');
                mediaElement.style.cursor = 'pointer';
                mediaElement.onclick = () => {
                    lightboxImg.src = mediaUrl;
                    lightbox.style.display = 'flex';
                };
            }
            botMessageElement.appendChild(mediaElement);
        }
        messagesContainer.appendChild(botMessageElement);
        setTimeout(() => {
            botMessageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }

    // --- FUNCIÓN PARA PROCESAR Y MOSTRAR DIÁLOGOS ---
    function showDialogue(data) {
        optionsContainer.innerHTML = '';

        if (data.message) {
            showBotMessage(data.message);
        }

        let infoText = '';
        if (data.title) {
            infoText += `<strong>${data.title}</strong><br>`;
        }
        if (data.content) {
            infoText += data.content;
        }
        
        if (infoText) {
            showBotMessage(infoText, data.mediaUrl || null);
        }

        if (data.options && data.options.length > 0) {
            data.options.forEach(option => {
                if (option.text && option.nextId) {
                    const button = document.createElement('button');
                    button.classList.add('option-button');
                    button.textContent = option.text;
                    button.onclick = () => handleOptionClick(option);
                    optionsContainer.appendChild(button);
                }
            });
        }

        // MODIFICADO: Añadimos el botón "Atrás" si no estamos en el primer paso.
        if (historyStack.length > 1) {
            const backButton = document.createElement('button');
            backButton.classList.add('option-button', 'back-button'); // Clase extra para estilo opcional
            backButton.textContent = '↩️ Atrás';
            backButton.onclick = goBack;
            // Lo añadimos al final de las opciones
            optionsContainer.appendChild(backButton);
        }
    }

    // --- FUNCIÓN PARA OBTENER DATOS DEL SERVIDOR ---
    async function getNextDialogue(id) {
        optionsContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Cargando...</p>';
        try {
            const response = await fetch(`/.netlify/functions/consulta_chatbot?id=${id}`);
            if (!response.ok) throw new Error('La respuesta del servidor no fue exitosa.');

            const data = await response.json();
            if (data) {
                showDialogue(data);
            } else {
                throw new Error('Los datos recibidos no tienen el formato esperado.');
            }
        } catch (error) {
            console.error("Hubo un error al obtener el diálogo:", error);
            showBotMessage('Lo siento, algo salió mal. Por favor, inténtalo más tarde.');
            optionsContainer.innerHTML = '';
        }
    }
});