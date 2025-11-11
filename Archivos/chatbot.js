// Archivo: chatbot.js (Versión final con Pan & Zoom y reapertura de chat)

document.addEventListener('DOMContentLoaded', () => {
    // --- Elementos del DOM (Chat) ---
    const chatBubble = document.getElementById('chat-bubble');
    const chatContainer = document.getElementById('chat-container');
    const closeChat = document.getElementById('close-chat');
    const messagesContainer = document.getElementById('chat-messages');
    const optionsContainer = document.getElementById('chat-options');

    // --- Elementos del DOM (Lightbox - Galería) ---
    const lightbox = document.getElementById('lightbox');
    const lightboxClose = document.querySelector('.lightbox-close');
    const galleryPrev = document.getElementById('gallery-prev');
    const galleryNext = document.getElementById('gallery-next');
    
    // ▼▼ INICIO DE CAMBIOS (NUEVOS ELEMENTOS DE ZOOM) ▼▼
    const imageWrapper = document.getElementById('lightbox-image-wrapper');
    const lightboxImg = document.getElementById('lightbox-img');
    const zoomToolbar = document.getElementById('zoom-toolbar');
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    // ▲▲ FIN DE CAMBIOS ▲▲

    // Verificación de elementos
    if (!chatBubble || !chatContainer || !closeChat || !messagesContainer || !optionsContainer || !lightbox || !lightboxClose || !galleryPrev || !galleryNext || !imageWrapper || !lightboxImg || !zoomToolbar || !zoomInBtn || !zoomOutBtn) {
        console.error("No se encontraron los elementos necesarios para el chatbot o la galería lightbox. Revisa el HTML.");
        // Muestra qué falta
        console.error({ chatBubble, chatContainer, closeChat, messagesContainer, optionsContainer, lightbox, lightboxClose, galleryPrev, galleryNext, imageWrapper, lightboxImg, zoomToolbar, zoomInBtn, zoomOutBtn });
        return;
    }

    let isChatInitiated = false;
    let historyStack = [];

    // ▼▼ INICIO DE CAMBIOS (ESTADO DE ZOOM Y PAN) ▼▼
    let currentGalleryImages = [];
    let currentGalleryIndex = 0;

    // Estado para Pan & Zoom
    const MIN_ZOOM = 1.0;
    const MAX_ZOOM = 3.0;
    const ZOOM_STEP = 0.5;
    let currentZoom = MIN_ZOOM;
    let isDragging = false;
    let startPan = { x: 0, y: 0 }; // Posición inicial del clic
    let currentPan = { x: 0, y: 0 }; // Desplazamiento actual
    let imageNaturalSize = { width: 0, height: 0 }; // Tamaño real de la imagen
    // ▲▲ FIN DE CAMBIOS ▲▲

    // --- ABRIR Y CERRAR EL CHAT ---
    // (Esta sección no tiene cambios)
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

    // --- LÓGICA DEL LIGHTBOX (GALERÍA MEJORADA CON PAN & ZOOM) ---

    // ▼▼ INICIO DE CAMBIOS (NUEVAS FUNCIONES DE TRANSFORMACIÓN) ▼▼
    
    // Resetea el zoom y pan a su estado inicial
    function resetImageTransform() {
        currentZoom = MIN_ZOOM;
        currentPan = { x: 0, y: 0 };
        
        // Obtenemos el tamaño del 'wrapper' y de la imagen
        const wrapperRect = imageWrapper.getBoundingClientRect();
        
        // Calculamos el zoom inicial para que la imagen quepa ("fit")
        const scaleX = wrapperRect.width / imageNaturalSize.width;
        const scaleY = wrapperRect.height / imageNaturalSize.height;
        currentZoom = Math.min(scaleX, scaleY, MIN_ZOOM); // No queremos que sea más grande que 1.0 al inicio
        
        // Si la imagen es más pequeña que la pantalla, la centramos con zoom 1.0
        if (imageNaturalSize.width < wrapperRect.width && imageNaturalSize.height < wrapperRect.height) {
            currentZoom = MIN_ZOOM;
        }

        updateImageTransform();
    }

    // Aplica la transformación CSS (scale y translate) a la imagen
    function updateImageTransform() {
        // Limitamos el "pan" para que no se salga de los bordes (opcional pero recomendado)
        // Esta parte puede ser compleja, por ahora solo aplicamos el transform
        
        lightboxImg.style.transform = `translate(${currentPan.x}px, ${currentPan.y}px) scale(${currentZoom})`;
        
        // Actualiza el cursor
        if (currentZoom > MIN_ZOOM) {
            lightboxImg.style.cursor = 'grab';
        } else {
            lightboxImg.style.cursor = 'zoom-in';
        }
        
        // Deshabilitar botones de zoom en los límites
        zoomInBtn.disabled = currentZoom >= MAX_ZOOM;
        zoomOutBtn.disabled = currentZoom <= MIN_ZOOM;
    }

    // CERRAR LIGHTBOX (Modificado)
    function closeLightbox() {
        lightbox.style.display = 'none';
        chatContainer.classList.add('open'); // Vuelve a abrir el chat
        
        // Ocultar controles
        galleryPrev.style.display = 'none';
        galleryNext.style.display = 'none';
        zoomToolbar.style.display = 'none'; // Ocultar barra de zoom
        
        // Limpiar galería
        currentGalleryImages = [];
        currentGalleryIndex = 0;
        
        // Resetear transformaciones de la imagen
        lightboxImg.style.transform = 'none'; 
        lightboxImg.style.opacity = 0; // Ocultar para la carga de la siguiente
    }

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        // Cierra solo si se hace clic en el fondo (el wrapper o el lightbox mismo)
        if (e.target === lightbox || e.target === imageWrapper) { 
            closeLightbox();
        }
    });

    // MOSTRAR IMAGEN DE GALERÍA (Modificado)
    function showGalleryImage(index) {
        if (index < 0 || index >= currentGalleryImages.length) {
            return; 
        }
        
        currentGalleryIndex = index;
        lightboxImg.style.opacity = 0; // Ocultar mientras carga
        lightboxImg.src = currentGalleryImages[currentGalleryIndex];
        
        // Cuando la nueva imagen cargue, reseteamos el zoom
        lightboxImg.onload = () => {
            // Guardamos el tamaño real de la imagen
            imageNaturalSize = { width: lightboxImg.naturalWidth, height: lightboxImg.naturalHeight };
            resetImageTransform(); // Aplicamos el zoom "fit" inicial
            lightboxImg.style.opacity = 1; // Mostrar imagen
        };

        // Mostrar/ocultar flechas
        galleryPrev.style.display = (currentGalleryIndex > 0) ? 'block' : 'none';
        galleryNext.style.display = (currentGalleryIndex < currentGalleryImages.length - 1) ? 'block' : 'none';
    }
    
    // NAVEGACIÓN (Sin cambios en lógica, solo llaman a showGalleryImage)
    galleryPrev.addEventListener('click', (e) => {
        e.stopPropagation(); 
        showGalleryImage(currentGalleryIndex - 1);
    });

    galleryNext.addEventListener('click', (e) => {
        e.stopPropagation(); 
        showGalleryImage(currentGalleryIndex + 1);
    });
    
    // ABRIR GALERÍA (Modificado)
    function openGallery(images, startIndex) {
        currentGalleryImages = images;
        lightbox.style.display = 'flex';
        zoomToolbar.style.display = 'flex'; // Mostrar barra de zoom
        chatContainer.classList.remove('open');
        showGalleryImage(startIndex);
    }
    
    // --- NUEVOS EVENT LISTENERS PARA PAN & ZOOM ---

    // Botones de Zoom
    zoomInBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentZoom = Math.min(currentZoom + ZOOM_STEP, MAX_ZOOM);
        updateImageTransform();
    });

    zoomOutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentZoom = Math.max(currentZoom - ZOOM_STEP, MIN_ZOOM);
        
        // Si volvemos al zoom mínimo, centramos la imagen
        if (currentZoom === MIN_ZOOM) {
            currentPan = { x: 0, y: 0 };
        }
        updateImageTransform();
    });
    
    // Arrastrar para Pan (Mover)
    
    lightboxImg.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Evitar que la imagen se arrastre (comportamiento nativo)
        
        if (currentZoom <= MIN_ZOOM) {
            // Si no hay zoom, un clic hace "zoom in"
            currentZoom += ZOOM_STEP;
            updateImageTransform();
            return;
        }
        
        // Iniciar arrastre
        isDragging = true;
        startPan.x = e.clientX - currentPan.x; // e.clientX es la pos del mouse
        startPan.y = e.clientY - currentPan.y;
        lightboxImg.style.cursor = 'grabbing';
    });
    
    // Mover el mouse (sobre el wrapper para no perderlo)
    imageWrapper.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        e.preventDefault();
        
        // Calculamos el nuevo pan
        currentPan.x = e.clientX - startPan.x;
        currentPan.y = e.clientY - startPan.y;
        
        updateImageTransform(); // Aplicamos la nueva posición
    });

    // Soltar el clic (sobre el wrapper)
    imageWrapper.addEventListener('mouseup', (e) => {
        isDragging = false;
        if (currentZoom > MIN_ZOOM) {
            lightboxImg.style.cursor = 'grab';
        } else {
            lightboxImg.style.cursor = 'zoom-in';
        }
    });

    // Si el mouse se sale del wrapper, dejamos de arrastrar
    imageWrapper.addEventListener('mouseleave', (e) => {
        isDragging = false;
        if (currentZoom > MIN_ZOOM) {
            lightboxImg.style.cursor = 'grab';
        }
    });

    // ▲▲ FIN DE CAMBIOS ▲▲

    // --- MANEJO DE LA INTERACCIÓN DEL USUARIO (Sin cambios) ---
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

    // --- FUNCIÓN PARA MANEJAR LA LÓGICA DE RETROCESO (Sin cambios) ---
    function goBack() {
        if (historyStack.length > 1) {
            historyStack.pop();
            const previousId = historyStack[historyStack.length - 1];
            getNextDialogue(previousId);
        }
    }

    // --- FUNCIÓN CENTRAL PARA MOSTRAR MENSAJES DEL BOT ---
    // (La lógica interna de esta función es la misma que la versión anterior de galería)
    function showBotMessage(text, mediaUrl = null) {
        const botMessageElement = document.createElement('div');
        botMessageElement.classList.add('bot-message');

        let formattedText = text.replace(/(?<!http:|https:)\/\//g, '<br><br>');
        
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        // Modificación: Evitar que las URLs de la galería se conviertan en enlaces <a>
        formattedText = formattedText.replace(urlRegex, (url) => {
            if (Array.isArray(mediaUrl) && mediaUrl.includes(url)) {
                return url; 
            }
            if (typeof mediaUrl === 'string' && mediaUrl === url) {
                 return url; 
            }
            return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });

        botMessageElement.innerHTML = formattedText;

        if (mediaUrl) {
            let mediaElement;
            
            // CASO 1: mediaUrl es un array (GALERÍA)
            if (Array.isArray(mediaUrl) && mediaUrl.length > 0) {
                mediaElement = document.createElement('div');
                mediaElement.classList.add('gallery-preview');
                
                const img = document.createElement('img');
                img.src = mediaUrl[0];
                img.classList.add('chat-media');
                img.style.cursor = 'pointer';
                img.onclick = () => {
                    openGallery(mediaUrl, 0); 
                };
                mediaElement.appendChild(img);
                
                if (mediaUrl.length > 1) {
                    const countBadge = document.createElement('span');
                    countBadge.classList.add('gallery-badge');
                    countBadge.textContent = `+${mediaUrl.length - 1}`;
                    countBadge.onclick = (e) => {
                        e.stopPropagation(); 
                        openGallery(mediaUrl, 0); 
                    };
                    mediaElement.appendChild(countBadge);
                }
                
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
                            max-width: 100%; 
                        }
                    `;
                    document.head.appendChild(style); 
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
                        openGallery([mediaUrl], 0); 
                    };
                }
            }

            if(mediaElement) {
                botMessageElement.appendChild(mediaElement);
            }
        }
        messagesContainer.appendChild(botMessageElement);
        setTimeout(() => {
            botMessageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }

    // --- FUNCIÓN PARA PROCESAR Y MOSTRAR DIÁLOGOS (Sin cambios) ---
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
        
        if (infoText || data.mediaUrl) { 
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

        if (historyStack.length > 1) {
            const backButton = document.createElement('button');
            backButton.classList.add('option-button', 'back-button');
            backButton.textContent = '↩️ Atrás';
            backButton.onclick = goBack;
            optionsContainer.appendChild(backButton);
        }
    }

    // --- FUNCIÓN PARA OBTENER DATOS DEL SERVIDOR (Sin cambios) ---
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

