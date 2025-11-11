// Archivo: chatbot.js (Versión final con GALERÍA y reapertura de chat)

document.addEventListener('DOMContentLoaded', () => {
    // --- Elementos del DOM ---
    const chatBubble = document.getElementById('chat-bubble');
    const chatContainer = document.getElementById('chat-container');
    const closeChat = document.getElementById('close-chat');
    const messagesContainer = document.getElementById('chat-messages');
    const optionsContainer = document.getElementById('chat-options');

    // --- Elementos para el Lightbox (GALERÍA) ---
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxClose = document.querySelector('.lightbox-close');
    
    // ▼▼ NUEVO: Elementos de la galería (Asegúrate de tenerlos en tu HTML) ▼▼
    const galleryPrev = document.getElementById('gallery-prev');
    const galleryNext = document.getElementById('gallery-next');
    const galleryZoom = document.getElementById('gallery-zoom');
    // ▲▲ FIN DE NUEVO ▲▲

    if (!chatBubble || !chatContainer || !closeChat || !messagesContainer || !optionsContainer || !lightbox || !lightboxImg || !lightboxClose || !galleryPrev || !galleryNext || !galleryZoom) {
        console.error("No se encontraron los elementos necesarios para el chatbot o la galería lightbox. Revisa el HTML.");
        console.error("Elementos faltantes:", {
            galleryPrev: !!galleryPrev,
            galleryNext: !!galleryNext,
            galleryZoom: !!galleryZoom,
            lightbox: !!lightbox
        });
        return;
    }

    let isChatInitiated = false;
    let historyStack = [];
    
    // ▼▼ NUEVO: Estado de la galería ▼▼
    let currentGalleryImages = [];
    let currentGalleryIndex = 0;
    let isZoomed = false;
    // ▲▲ FIN DE NUEVO ▲▲

    // --- ABRIR Y CERRAR EL CHAT ---
    chatBubble.addEventListener('click', () => {
        chatContainer.classList.toggle('open');
        if (!isChatInitiated && chatContainer.classList.contains('open')) {
            const welcomeMessage = "¡Hola! Soy Quali, tu asistente virtual. Puedo ayudarte a resolver las dudas más frecuentes. Para empezar, selecciona el área que deseas consultar.";
            showBotMessage(welcomeMessage);
            historyStack = ['0'];
            getNextDialogue('0');
            isChatInitiated = true;
        }
    });

    closeChat.addEventListener('click', () => {
        chatContainer.classList.remove('open');
    });

    // --- LÓGICA DEL LIGHTBOX (GALERÍA MEJORADA) ---

    // ▼▼ MODIFICADO: Cerrar el lightbox ▼▼
    function closeLightbox() {
        lightbox.style.display = 'none';
        chatContainer.classList.add('open'); // Vuelve a abrir el chat
        
        // Ocultar controles de galería
        galleryPrev.style.display = 'none';
        galleryNext.style.display = 'none';
        galleryZoom.style.display = 'none';
        
        // Resetear zoom
        lightboxImg.classList.remove('zoomed');
        isZoomed = false;
        
        // Limpiar galería
        currentGalleryImages = [];
        currentGalleryIndex = 0;
    }

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) { // Si se hace clic en el fondo oscuro
            closeLightbox();
        }
    });
    // ▲▲ FIN DE MODIFICADO ▲▲
    
    // ▼▼ NUEVO: Navegación de la galería ▼▼
    function showGalleryImage(index) {
        if (index < 0 || index >= currentGalleryImages.length) {
            return; // No hacer nada si el índice está fuera de rango
        }
        
        currentGalleryIndex = index;
        lightboxImg.src = currentGalleryImages[currentGalleryIndex];
        
        // Resetear zoom al cambiar de imagen
        lightboxImg.classList.remove('zoomed');
        isZoomed = false;

        // Mostrar/ocultar flechas
        galleryPrev.style.display = (currentGalleryIndex > 0) ? 'block' : 'none';
        galleryNext.style.display = (currentGalleryIndex < currentGalleryImages.length - 1) ? 'block' : 'none';
    }

    galleryPrev.addEventListener('click', (e) => {
        e.stopPropagation(); // Evitar que el clic cierre el lightbox
        showGalleryImage(currentGalleryIndex - 1);
    });

    galleryNext.addEventListener('click', (e) => {
        e.stopPropagation(); // Evitar que el clic cierre el lightbox
        showGalleryImage(currentGalleryIndex + 1);
    });
    
    // Zoom
    galleryZoom.addEventListener('click', (e) => {
        e.stopPropagation();
        isZoomed = !isZoomed;
        lightboxImg.classList.toggle('zoomed', isZoomed);
    });
    
    // También permitir zoom/unzoom al hacer clic en la imagen
    lightboxImg.addEventListener('click', (e) => {
        e.stopPropagation();
        isZoomed = !isZoomed;
        lightboxImg.classList.toggle('zoomed', isZoomed);
    });

    // Función para abrir la galería
    function openGallery(images, startIndex) {
        currentGalleryImages = images;
        lightbox.style.display = 'flex';
        galleryZoom.style.display = 'block'; // Mostrar botón de zoom
        chatContainer.classList.remove('open');
        showGalleryImage(startIndex);
    }
    // ▲▲ FIN DE NUEVO ▲▲

    // --- MANEJO DE LA INTERACCIÓN DEL USUARIO ---
    function handleOptionClick(option) {
        const userMessageElement = document.createElement('div');
        userMessageElement.classList.add('user-message');
        userMessageElement.textContent = option.text;
        messagesContainer.appendChild(userMessageElement);

        optionsContainer.querySelectorAll('.option-button').forEach(button => {
            button.disabled = true;
        });

        if (option.nextId === '0') {
            historyStack = ['0'];
        } else {
            historyStack.push(option.nextId);
        }

        getNextDialogue(option.nextId);
    }

    // --- FUNCIÓN PARA MANEJAR LA LÓGICA DE RETROCESO ---
    function goBack() {
        if (historyStack.length > 1) {
            historyStack.pop();
            const previousId = historyStack[historyStack.length - 1];
            getNextDialogue(previousId);
        }
    }

    // --- FUNCIÓN CENTRAL PARA MOSTRAR MENSAJES DEL BOT (MODIFICADA) ---
    function showBotMessage(text, mediaUrl = null) {
        const botMessageElement = document.createElement('div');
        botMessageElement.classList.add('bot-message');

        let formattedText = text.replace(/(?<!http:|https:)\/\//g, '<br><br>');
        
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        // Modificación: Evitar que las URLs de la galería se conviertan en enlaces <a>
        formattedText = formattedText.replace(urlRegex, (url) => {
            // Si mediaUrl es un array y la url está en él, no la conviertas en enlace
            if (Array.isArray(mediaUrl) && mediaUrl.includes(url)) {
                return url; // Devuelve la URL como texto plano
            }
            // Si mediaUrl es un string y es igual a la url, no la conviertas
            if (typeof mediaUrl === 'string' && mediaUrl === url) {
                 return url; // Devuelve la URL como texto plano
            }
            // Si no, es un enlace normal en el texto
            return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });

        botMessageElement.innerHTML = formattedText;

        if (mediaUrl) {
            let mediaElement;
            
            // ▼▼ LÓGICA MODIFICADA para mediaUrl (string o array) ▼▼
            
            // CASO 1: mediaUrl es un array (GALERÍA)
            if (Array.isArray(mediaUrl) && mediaUrl.length > 0) {
                mediaElement = document.createElement('div');
                mediaElement.classList.add('gallery-preview');
                
                // Mostrar la primera imagen como miniatura
                const img = document.createElement('img');
                img.src = mediaUrl[0];
                img.classList.add('chat-media');
                img.style.cursor = 'pointer';
                img.onclick = () => {
                    openGallery(mediaUrl, 0); // Abrir galería en la imagen 0
                };
                mediaElement.appendChild(img);
                
                // Añadir un indicador de cuántas imágenes más hay
                if (mediaUrl.length > 1) {
                    const countBadge = document.createElement('span');
                    countBadge.classList.add('gallery-badge');
                    countBadge.textContent = `+${mediaUrl.length - 1}`;
                    countBadge.onclick = (e) => {
                        e.stopPropagation(); // Evitar que el clic también dispare el clic de la imagen
                        openGallery(mediaUrl, 0); // Abrir galería
                    };
                    mediaElement.appendChild(countBadge);
                }
                
                // (Opcional) Añadir CSS para .gallery-preview y .gallery-badge
                // Es mejor poner esto en tu archivo CSS principal, pero funciona aquí
                const styleId = 'gallery-styles';
                if (!document.getElementById(styleId)) {
                    const style = document.createElement('style');
                    style.id = styleId;
                    style.innerHTML = `
                        .gallery-preview { 
                            position: relative; 
                            display: inline-block; 
                            max-width: 100%;
                        }
                        .gallery-badge { 
                            position: absolute; 
                            bottom: 15px; 
                            right: 10px; 
                            background-color: rgba(0,0,0,0.7); 
                            color: white; 
                            padding: 5px 8px; 
                            border-radius: 10px; 
                            font-size: 12px; 
                            font-weight: bold;
                            cursor: pointer;
                            transition: background-color 0.2s;
                        }
                        .gallery-badge:hover {
                            background-color: rgba(0,0,0,0.9);
                        }
                        .chat-media {
                            max-width: 100%; /* Asegura que la imagen no se desborde */
                        }
                    `;
                    document.head.appendChild(style); // Añade el estilo
                }
                
            } 
            // CASO 2: mediaUrl es un string (PDF, MP4, o IMAGEN ÚNICA)
            else if (typeof mediaUrl === 'string') {
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
                    // Imagen única
                    mediaElement = document.createElement('img');
                    mediaElement.src = mediaUrl;
                    mediaElement.classList.add('chat-media');
                    mediaElement.style.cursor = 'pointer';
                    mediaElement.onclick = () => {
                        // Abrir la galería pero con una sola imagen
                        openGallery([mediaUrl], 0); 
                    };
                }
            }
            // ▲▲ FIN DE LÓGICA MODIFICADA ▲▲

            if(mediaElement) {
                botMessageElement.appendChild(mediaElement);
            }
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
        
        // ▼▼ MODIFICACIÓN PEQUEÑA ▼▼
        // Mostrar este bloque solo si hay texto O mediaUrl
        if (infoText || data.mediaUrl) { 
            // Si no hay texto, pasa un string vacío, pero mediaUrl sí se procesa
            showBotMessage(infoText, data.mediaUrl || null); 
        }
        // ▲▲ FIN DE MODIFICACIÓN ▲▲

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

        if (historyStack.length > 1) {
            const backButton = document.createElement('button');
            backButton.classList.add('option-button', 'back-button');
            backButton.textContent = '↩️ Atrás';
            backButton.onclick = goBack;
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
