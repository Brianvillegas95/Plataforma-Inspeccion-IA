// Archivo: chatbot.js (Versión corregida y con todas las mejoras)

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

    // Verificación de que todos los elementos existan
    if (!chatBubble || !chatContainer || !closeChat || !messagesContainer || !optionsContainer || !lightbox || !lightboxImg || !lightboxClose) {
        console.error("No se encontraron los elementos necesarios para el chatbot o el lightbox. Revisa el HTML.");
        return;
    }

    let isChatInitiated = false;

    // --- ABRIR Y CERRAR EL CHAT ---
    chatBubble.addEventListener('click', () => {
        chatContainer.classList.toggle('open');
        // --- MEJORA: Lógica del mensaje de bienvenida ---
        if (!isChatInitiated && chatContainer.classList.contains('open')) {
            const welcomeMessage = "¡Hola! Soy Quali, tu asistente de calidad. Puedo ayudarte a resolver las dudas más frecuentes. Para empezar, selecciona el área que deseas consultar.";
            showBotMessage(welcomeMessage); // Muestra el mensaje de bienvenida
            getNextDialogue('0'); // Carga las opciones iniciales
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
        // Muestra la opción seleccionada por el usuario en el chat
        const userMessageElement = document.createElement('div');
        userMessageElement.classList.add('user-message');
        userMessageElement.textContent = option.text;
        messagesContainer.appendChild(userMessageElement);

        // Deshabilita los botones para evitar clics múltiples
        optionsContainer.querySelectorAll('.option-button').forEach(button => {
            button.disabled = true;
        });

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        getNextDialogue(option.nextId);
    }

    // --- FUNCIÓN CENTRAL PARA MOSTRAR MENSAJES DEL BOT ---
    // Esta función ahora crea todos los mensajes del bot, ya sean preguntas o respuestas.
    function showBotMessage(text, mediaUrl = null) {
        const botMessageElement = document.createElement('div');
        botMessageElement.classList.add('bot-message');

        // --- MEJORA: Reemplazar '//' por saltos de línea ---
        // Usamos innerHTML para que el navegador interprete la etiqueta <br>
        const formattedText = text.replace(/\/\//g, '<br><br>');
        botMessageElement.innerHTML = formattedText;

        // --- MEJORA: Lógica para mostrar y ampliar la imagen ---
        if (mediaUrl) {
            const mediaElement = document.createElement('img');
            mediaElement.src = mediaUrl;
            mediaElement.classList.add('chat-media');
            mediaElement.style.cursor = 'pointer';
            
            // Evento para abrir el lightbox al hacer clic en la imagen
            mediaElement.onclick = () => {
                lightboxImg.src = mediaUrl;
                lightbox.style.display = 'flex';
            };
            
            botMessageElement.appendChild(mediaElement);
        }

        messagesContainer.appendChild(botMessageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // --- FUNCIÓN PARA PROCESAR Y MOSTRAR DIÁLOGOS ---
    function showDialogue(data) {
        optionsContainer.innerHTML = ''; // Limpiar opciones anteriores

        // --- CORRECCIÓN CLAVE: Mostrar el mensaje de la pregunta ---
        // Si la respuesta del backend contiene 'message', es una pregunta. La mostramos.
        if (data.message) {
            showBotMessage(data.message);
        }

        // Si la respuesta contiene 'title' o 'content', es información. La mostramos.
        let infoText = '';
        if (data.title) {
            infoText += `<strong>${data.title}</strong><br>`;
        }
        if (data.content) {
            infoText += data.content;
        }
        
        if (infoText) {
            // Pasamos también la URL de la imagen si existe
            showBotMessage(infoText, data.mediaUrl || null);
        }

        // Finalmente, creamos los botones de opciones
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