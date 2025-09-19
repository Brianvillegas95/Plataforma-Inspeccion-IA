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

    // *** NUEVA FUNCIÓN *** para manejar la selección del usuario
    // Esta función crea el mensaje del usuario y deshabilita los botones.
    function handleOptionClick(option) {
        // 1. Crear y mostrar el mensaje del usuario
        const userMessageElement = document.createElement('div');
        userMessageElement.classList.add('user-message'); // Clase para darle estilo
        userMessageElement.textContent = option.text;
        messagesContainer.appendChild(userMessageElement);

        // 2. Deshabilitar todos los botones de la selección actual
        const currentButtons = optionsContainer.querySelectorAll('.option-button');
        currentButtons.forEach(button => {
            button.disabled = true;
        });

        // 3. Desplazar la vista al último mensaje
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // 4. Llamar a la función para obtener la siguiente respuesta del bot
        getNextDialogue(option.nextId);
    }

    // --- FUNCIÓN MODIFICADA Y ACTUALIZADA ---
    // Función para mostrar un nuevo paso de la conversación
    function showDialogue(dialogue) {
        // Limpiamos las opciones anteriores
        optionsContainer.innerHTML = ''; 

        // --- INICIO DE LA MODIFICACIÓN ---
        // Definimos un umbral: si hay más de 7 opciones, activamos el scroll.
        const scrollThreshold = 7;

        // Verificamos si la cantidad de opciones supera nuestro umbral.
        if (dialogue.options && dialogue.options.length > scrollThreshold) {
            // Si hay muchas opciones, AÑADIMOS la clase para activar el scroll.
            optionsContainer.classList.add('scrollable-options');
        } else {
            // Si hay pocas opciones, NOS ASEGURAMOS de que la clase NO esté.
            // Esto es importante para cuando pasas de una lista larga a una corta.
            optionsContainer.classList.remove('scrollable-options');
        }
        // --- FIN DE LA MODIFICACIÓN ---
        
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
                    button.onclick = () => handleOptionClick(option); 
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
            const response = await fetch(`/.netlify/functions/consulta_chatbot?id=${id}`);
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
            getNextDialogue(0); // Carga el primer mensaje (ID 0 o 1, según tu config)
            isChatInitiated = true; // Marca como iniciado para no volver a cargarlo
        }
    });
});