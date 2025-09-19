document.addEventListener('DOMContentLoaded', () => {
    // --- ELEMENTOS DEL DOM PARA EL WIDGET ---
    const chatBubble = document.getElementById('chat-bubble');
    const chatContainer = document.getElementById('chat-container');
    const closeChat = document.getElementById('close-chat');
    const messagesContainer = document.getElementById('chat-messages');
    const optionsContainer = document.getElementById('chat-options');

    // Verifica que todos los elementos existan antes de continuar
    if (!chatBubble || !chatContainer || !closeChat || !messagesContainer || !optionsContainer) {
        console.error("No se encontraron los elementos necesarios para el chatbot. Revisa el HTML.");
        return;
    }
    
    // --- LÓGICA PARA ABRIR Y CERRAR EL CHAT ---
    chatBubble.addEventListener('click', () => {
        chatContainer.classList.toggle('open');
    });

    closeChat.addEventListener('click', () => {
        chatContainer.classList.remove('open');
    });

    // --- LÓGICA PARA LA CONVERSACIÓN DEL CHAT ---
    let isChatInitiated = false;

    // Función para mostrar un nuevo paso de la conversación
    function showDialogue(dialogue) {
        optionsContainer.innerHTML = ''; // Limpia opciones anteriores
        
        // Crea y muestra el nuevo mensaje del bot
        const messageElement = document.createElement('div');
        messageElement.classList.add('bot-message');
        messageElement.textContent = dialogue.message;
        messagesContainer.appendChild(messageElement);
        
        // Desplaza la vista al último mensaje
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Crea y muestra los nuevos botones de opción, si existen
        if (dialogue.options && dialogue.options.length > 0) {
            dialogue.options.forEach(option => {
                if (option.text && option.nextId) { // Solo crea el botón si tiene texto y un nextId
                    const button = document.createElement('button');
                    button.classList.add('option-button');
                    button.textContent = option.text;
                    button.onclick = () => getNextDialogue(option.nextId);
                    optionsContainer.appendChild(button);
                }
            });
        }
    }

    // Función para llamar a nuestro "robot" (la Netlify Function)
    async function getNextDialogue(id) {
        optionsContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Cargando...</p>';
        try {
            // La URL de nuestra función en Netlify. '/.netlify/functions/' es la ruta estándar.
            const response = await fetch(`/.netlify/functions/get-dialogue?id=${id}`);
            
            if (!response.ok) {
                throw new Error('La respuesta del servidor no fue exitosa.');
            }

            const data = await response.json();

            if (data && data.message) {
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

    // Inicia el chat solo la primera vez que se abre la ventana
    chatBubble.addEventListener('click', () => {
        if (!isChatInitiated && chatContainer.classList.contains('open')) {
            getNextDialogue(1); // Carga el primer mensaje (ID 1)
            isChatInitiated = true; // Marca como iniciado para no volver a cargarlo
        }
    });
});