// Archivo: js/chatbot.js o Archivos/chatbot.js (versión con historial de chat)

document.addEventListener('DOMContentLoaded', () => {
    const chatBubble = document.getElementById('chat-bubble');
    const chatContainer = document.getElementById('chat-container');
    const closeChat = document.getElementById('close-chat');
    const messagesContainer = document.getElementById('chat-messages');
    const optionsContainer = document.getElementById('chat-options');

    if (!chatBubble || !chatContainer || !closeChat || !messagesContainer || !optionsContainer) {
        console.error("No se encontraron los elementos necesarios para el chatbot.");
        return;
    }
    
    chatBubble.addEventListener('click', () => chatContainer.classList.toggle('open'));
    closeChat.addEventListener('click', () => chatContainer.classList.remove('open'));

    let isChatInitiated = false;

    // --- ¡NUEVA FUNCIÓN! ---
    // Esta función añade el mensaje del usuario al historial del chat.
    function addUserMessage(text) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('user-message');
        messageElement.textContent = text;
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // --- FUNCIÓN MODIFICADA ---
    // Ahora, en lugar de borrar, esta función añade el mensaje del bot y los nuevos botones.
    function showDialogue(dialogue) {
        optionsContainer.innerHTML = ''; // Limpia solo las opciones viejas

        const messageElement = document.createElement('div');
        messageElement.classList.add('bot-message');
        messageElement.textContent = dialogue.message;
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        if (dialogue.options && dialogue.options.length > 0) {
            dialogue.options.forEach(option => {
                const button = document.createElement('button');
                button.classList.add('option-button');
                button.textContent = option.text;

                // --- ¡LÓGICA MODIFICADA! ---
                button.onclick = (event) => {
                    // 1. Muestra la respuesta del usuario en el chat
                    addUserMessage(option.text);

                    // 2. Deshabilita TODOS los botones de la selección actual
                    const allButtons = optionsContainer.querySelectorAll('.option-button');
                    allButtons.forEach(btn => btn.disabled = true);
                    
                    // 3. Llama a la siguiente pregunta
                    getNextDialogue(option.nextId);
                };
                optionsContainer.appendChild(button);
            });
        }
    }

    async function getNextDialogue(id) {
        optionsContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Cargando...</p>';
        try {
            const response = await fetch(`/.netlify/functions/chatbot?id=${id}`);
            if (!response.ok) throw new Error('Respuesta del servidor no fue exitosa.');
            const data = await response.json();
            if (data && data.message) {
                showDialogue(data);
            } else {
                throw new Error('Datos recibidos sin formato esperado.');
            }
        } catch (error) {
            console.error("Hubo un error al obtener el diálogo:", error);
            const errorElement = document.createElement('div');
            errorElement.classList.add('bot-message');
            errorElement.textContent = 'Lo siento, algo salió mal. Por favor, inténtalo más tarde.';
            messagesContainer.appendChild(errorElement);
            optionsContainer.innerHTML = '';
        }
    }

    chatBubble.addEventListener('click', () => {
        if (!isChatInitiated && chatContainer.classList.contains('open')) {
            getNextDialogue('0');
            isChatInitiated = true;
        }
    });
});