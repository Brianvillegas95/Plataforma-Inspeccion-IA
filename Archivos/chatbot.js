// Archivo: chatbot.js (Versión con scroll al inicio del último mensaje y soporte para PDF/Video/Imagen)

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

    // --- MANEJO DE LA INTERACCIÓN DEL USUARIO ---
    function handleOptionClick(option) {
        const userMessageElement = document.createElement('div');
        userMessageElement.classList.add('user-message');
        userMessageElement.textContent = option.text;
        messagesContainer.appendChild(userMessageElement);

        optionsContainer.querySelectorAll('.option-button').forEach(button => {
            button.disabled = true;
        });

        getNextDialogue(option.nextId);
    }

    // --- FUNCIÓN CENTRAL PARA MOSTRAR MENSAJES DEL BOT ---
    function showBotMessage(text, mediaUrl = null) {
        const botMessageElement = document.createElement('div');
        botMessageElement.classList.add('bot-message');

        const formattedText = text.replace(/\/\//g, '<br><br>');
        botMessageElement.innerHTML = formattedText;

        if (mediaUrl) {
            let mediaElement;
            const mediaUrlLower = mediaUrl.toLowerCase();

            // 1. Verificamos si la URL es un PDF
            if (mediaUrlLower.endsWith('.pdf')) {
                mediaElement = document.createElement('a');
                mediaElement.href = mediaUrl;
                mediaElement.target = '_blank'; // Abre el PDF en una nueva pestaña
                mediaElement.rel = 'noopener noreferrer'; // Medida de seguridad
                mediaElement.textContent = '📄 Ver Documento (PDF)';
                // Se recomienda añadir una clase para darle estilo con CSS
                mediaElement.classList.add('chat-media-link');

            // 2. Verificamos si es un video
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

            // 3. Si no es PDF ni video, asumimos que es una imagen
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
        }, 100); // Un pequeño retardo para asegurar que el elemento se ha renderizado.
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