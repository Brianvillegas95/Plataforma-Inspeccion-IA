document.addEventListener('DOMContentLoaded', () => {
    const chatBubble = document.getElementById('chat-bubble');
    const chatContainer = document.getElementById('chat-container');
    const closeChat = document.getElementById('close-chat');
    const messagesContainer = document.getElementById('chat-messages');
    const optionsContainer = document.getElementById('chat-options');

    if (!chatBubble || !chatContainer || !closeChat || !messagesContainer || !optionsContainer) {
        console.error("No se encontraron los elementos necesarios para el chatbot. Revisa el HTML.");
        return;
    }
    
    chatBubble.addEventListener('click', () => {
        chatContainer.classList.toggle('open');
    });

    closeChat.addEventListener('click', () => {
        chatContainer.classList.remove('open');
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

    function showDialogue(dialogue) {
        optionsContainer.innerHTML = ''; 

        const scrollThreshold = 4;
        if (dialogue.options && dialogue.options.length > scrollThreshold) {
            optionsContainer.classList.add('scrollable-options');
        } else {
            optionsContainer.classList.remove('scrollable-options');
        }
        
        const messageElement = document.createElement('div');
        messageElement.classList.add('bot-message');

        if (dialogue.title && dialogue.content) {
            messageElement.innerHTML = `<strong>${dialogue.title}</strong><br>${dialogue.content}`;
        } else {
            messageElement.textContent = dialogue.message;
        }
        
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        if (dialogue.options && dialogue.options.length > 0) {
            dialogue.options.forEach(option => {
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
            const errorElement = document.createElement('div');
            errorElement.classList.add('bot-message');
            errorElement.textContent = 'Lo siento, algo salió mal al intentar conectar. Por favor, inténtalo más tarde.';
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