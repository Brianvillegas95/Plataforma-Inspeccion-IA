// Archivo: chatbot.js (Versión con corrección de scroll automático)

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

    // --- ABRIR Y CERRAR EL CHAT ---
    chatBubble.addEventListener('click', () => {
        chatContainer.classList.toggle('open');
        if (!isChatInitiated && chatContainer.classList.contains('open')) {
            const welcomeMessage = "¡Hola! Soy Quali, tu asistente de calidad. Puedo ayudarte a resolver las dudas más frecuentes. Para empezar, selecciona el área que deseas consultar.";
            showBotMessage(welcomeMessage);
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

    // --- FUNCIÓN PARA FORZAR EL SCROLL HACIA ABAJO ---
    // Creamos una función específica para esto para no repetir código.
    function scrollToBottom() {
        // --- CORRECCIÓN DE SCROLL ---
        // Se añade un pequeño retardo (50 milisegundos) para dar tiempo al navegador
        // a renderizar el nuevo mensaje antes de calcular la altura para el scroll.
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 50);
    }

    // --- MANEJO DE LA INTERACCIÓN DEL USUARIO ---
    function handleOptionClick(option) {
        const userMessageElement = document.createElement('div');
        userMessageElement.classList.add('user-message');
        userMessageElement.textContent = option.text;
        messagesContainer.appendChild(userMessageElement);

        optionsContainer.querySelectorAll('.option-button').forEach(button => {
            button.disabled = true;
        });

        scrollToBottom(); // Usamos la nueva función de scroll
        getNextDialogue(option.nextId);
    }

    // --- FUNCIÓN CENTRAL PARA MOSTRAR MENSAJES DEL BOT ---
    function showBotMessage(text, mediaUrl = null) {
        const botMessageElement = document.createElement('div');
        botMessageElement.classList.add('bot-message');

        const formattedText = text.replace(/\/\//g, '<br><br>');
        botMessageElement.innerHTML = formattedText;

        if (mediaUrl) {
            const mediaElement = document.createElement('img');
            mediaElement.src = mediaUrl;
            mediaElement.classList.add('chat-media');
            mediaElement.style.cursor = 'pointer';
            
            mediaElement.onclick = () => {
                lightboxImg.src = mediaUrl;
                lightbox.style.display = 'flex';
            };
            
            botMessageElement.appendChild(mediaElement);
        }

        messagesContainer.appendChild(botMessageElement);
        scrollToBottom(); // Usamos la nueva función de scroll aquí también
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
            // Hacemos un último scroll por si los botones nuevos ocupan espacio
            scrollToBottom();
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