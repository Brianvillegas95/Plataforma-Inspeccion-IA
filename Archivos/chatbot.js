// Archivo: chatbot.js

document.addEventListener('DOMContentLoaded', () => {
    const chatBubble = document.getElementById('chat-bubble');
    const chatContainer = document.getElementById('chat-container');
    const closeChat = document.getElementById('close-chat');
    const messagesContainer = document.getElementById('chat-messages');
    const optionsContainer = document.getElementById('chat-options');

    // --- NUEVO: Elementos para el Lightbox (imagen en pantalla completa) ---
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxClose = document.querySelector('.lightbox-close');

    if (!chatBubble || !chatContainer || !closeChat || !messagesContainer || !optionsContainer || !lightbox || !lightboxImg || !lightboxClose) {
        console.error("No se encontraron los elementos necesarios para el chatbot o el lightbox. Revisa el HTML.");
        return;
    }

    chatBubble.addEventListener('click', () => {
        chatContainer.classList.toggle('open');
        // --- MODIFICACIÓN 3: Lógica del mensaje de bienvenida ---
        if (!isChatInitiated && chatContainer.classList.contains('open')) {
            // Mostramos el mensaje de bienvenida inmediatamente
            const welcomeMessage = "¡Hola! Soy Quali, tu asistente de calidad. Puedo ayudarte a resolver las dudas más frecuentes. Para empezar, selecciona el área que deseas consultar.";
            showBotMessage(welcomeMessage);
            // Cargamos las opciones iniciales
            getNextDialogue('0');
            isChatInitiated = true;
        }
    });

    closeChat.addEventListener('click', () => {
        chatContainer.classList.remove('open');
    });
    
    // --- NUEVO: Cerrar lightbox al hacer clic en el botón de cerrar ---
    lightboxClose.addEventListener('click', () => {
        lightbox.style.display = 'none';
    });
    
    // --- NUEVO: Cerrar lightbox al hacer clic fuera de la imagen ---
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            lightbox.style.display = 'none';
        }
    });


    let isChatInitiated = false;

    function handleOptionClick(option) {
        const userMessageElement = document.createElement('div');
        userMessageElement.classList.add('user-message');
        userMessageElement.textContent = option.text;
        messagesContainer.appendChild(userMessageElement);

        const currentButtons = optionsContainer.querySelectorAll('.option-button');
        currentButtons.forEach(button => {
            button.disabled = true;
        });

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        getNextDialogue(option.nextId);
    }

    // --- NUEVO: Función reutilizable para mostrar mensajes del bot ---
    function showBotMessage(text, mediaUrl = null) {
        const botMessageElement = document.createElement('div');
        botMessageElement.classList.add('bot-message');

        // --- MODIFICACIÓN 1: Reemplazar '//' por saltos de línea ---
        // Usamos innerHTML para que el navegador interprete <br>
        const formattedText = text.replace(/\/\//g, '<br><br>');
        botMessageElement.innerHTML = formattedText;

        messagesContainer.appendChild(botMessageElement);
        
        // --- MODIFICACIÓN 2: Lógica para mostrar y ampliar la imagen ---
        if (mediaUrl) {
            const mediaElement = document.createElement('img');
            mediaElement.src = mediaUrl;
            mediaElement.classList.add('chat-media');
            mediaElement.style.cursor = 'pointer'; // Cambia el cursor para indicar que es clickable
            
            // Evento para abrir el lightbox
            mediaElement.onclick = () => {
                lightboxImg.src = mediaUrl; // Carga la imagen en el lightbox
                lightbox.style.display = 'flex'; // Muestra el lightbox
            };
            
            botMessageElement.appendChild(mediaElement);
        }

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function showDialogue(data) {
        optionsContainer.innerHTML = ''; // Limpiar opciones anteriores
        
        // El título y el contenido se muestran en el mismo mensaje del bot
        let messageText = '';
        if (data.title) {
            messageText += `<b>${data.title}</b><br>`;
        }
        if (data.content) {
            messageText += data.content;
        }
        
        if(messageText){
            showBotMessage(messageText, data.mediaUrl);
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
            showBotMessage('Lo siento, algo salió mal al intentar conectar. Por favor, inténtalo más tarde.');
            optionsContainer.innerHTML = '';
        }
    }
    
    // Se elimina la lógica de inicio de chat de aquí porque se movió al primer 'click' del 'chatBubble'
});