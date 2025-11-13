// Archivo: chatbot.js (Versión final V8 - onload + rAF)

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
    
    const imageWrapper = document.getElementById('lightbox-image-wrapper');
    const lightboxImg = document.getElementById('lightbox-img');
    const zoomToolbar = document.getElementById('zoom-toolbar');
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const mainNavBar = document.querySelector('.app-header');
    
    // Verificación de elementos
    if (!chatBubble || !chatContainer || !closeChat || !messagesContainer || !optionsContainer || !lightbox || !lightboxClose || !galleryPrev || !galleryNext || !imageWrapper || !lightboxImg || !zoomToolbar || !zoomInBtn || !zoomOutBtn) {
        console.error("No se encontraron los elementos necesarios para el chatbot o la galería lightbox. Revisa el HTML.");
        console.error({ chatBubble, chatContainer, closeChat, messagesContainer, optionsContainer, lightbox, lightboxClose, galleryPrev, galleryNext, imageWrapper, lightboxImg, zoomToolbar, zoomInBtn, zoomOutBtn });
        return;
    }

    let isChatInitiated = false;
    let historyStack = [];

    // --- Estado de la Galería y Pan & Zoom ---
    let currentGalleryImages = [];
    let currentGalleryIndex = 0;

    const MAX_ZOOM = 3.0;        
    const ZOOM_STEP = 0.5;       
    const DEFAULT_ZOOM = 1.0;    

    let fitZoom = 1.0;           
    let currentZoom = 1.0;       
    let isDragging = false;
    let startPan = { x: 0, y: 0 }; 
    let currentPan = { x: 0, y: 0 }; 
    let imageNaturalSize = { width: 0, height: 0 }; 
    // Quitamos el 'imageCheckInterval'

    // --- ABRIR Y CERRAR EL CHAT (Sin cambios) ---
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

    // --- LÓGICA DEL LIGHTBOX (GALERÍA CORREGIDA V8) ---

    // Aplica la transformación CSS (scale y translate) a la imagen
    function updateImageTransform() {
        lightboxImg.style.transform = `translate(${currentPan.x}px, ${currentPan.y}px) scale(${currentZoom})`;
        
        if (currentZoom > fitZoom) {
            lightboxImg.style.cursor = 'grab'; 
        } else {
            lightboxImg.style.cursor = 'default'; 
        }
        
        zoomInBtn.disabled = currentZoom >= MAX_ZOOM;
        zoomOutBtn.disabled = currentZoom <= fitZoom;
    }

    // Resetea el zoom y pan a su estado inicial ("fit-to-screen")
    function resetImageTransform() {
        currentPan = { x: 0, y: 0 };
        
        const wrapperWidth = document.documentElement.clientWidth;
        const wrapperHeight = document.documentElement.clientHeight;

        // Guardia anti-división por cero
        if (wrapperWidth === 0 || wrapperHeight === 0 || !imageNaturalSize || imageNaturalSize.width === 0 || imageNaturalSize.height === 0) {
            console.error("Error al medir la ventana o la imagen (dimensiones 0). Se usará zoom 1.0 por defecto para evitar el colapso.");
            fitZoom = 1.0;
            currentZoom = 1.0;
        } else {
            // Cálculo de "fit-to-screen"
            const scaleX = wrapperWidth / imageNaturalSize.width;
            const scaleY = wrapperHeight / imageNaturalSize.height;
            
            if (imageNaturalSize.width < wrapperWidth && imageNaturalSize.height < wrapperHeight) {
                fitZoom = DEFAULT_ZOOM;
            } else {
                fitZoom = Math.min(scaleX, scaleY);
            }
            currentZoom = fitZoom; 
        }
        
        // Aplicamos el transform final
        updateImageTransform();
    }

    // CERRAR LIGHTBOX (Sin cambios)
    function closeLightbox() {
        if (mainNavBar) {
            mainNavBar.style.display = ''; // Restaura el display original
        }
        lightbox.style.display = 'none';
        chatContainer.classList.add('open'); 
        
        galleryPrev.style.display = 'none';
        galleryNext.style.display = 'none';
        zoomToolbar.style.display = 'none'; 
        
        currentGalleryImages = [];
        currentGalleryIndex = 0;
        
        lightboxImg.style.transform = 'none'; 
        lightboxImg.style.opacity = 0;
        
        // Ya no hay "vigilante" que limpiar
    }

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox || e.target === imageWrapper) { 
            closeLightbox();
        }
    });
    
    
    // ▼▼ INICIO DE LA CORRECCIÓN V8 (onload + rAF) ▼▼

    // MOSTRAR IMAGEN DE GALERÍA (Reescrito)
    function showGalleryImage(index) {
        if (index < 0 || index >= currentGalleryImages.length) {
            return; 
        }
        
        currentGalleryIndex = index;
        lightboxImg.style.opacity = 0; // Ocultamos la imagen

        // 1. Asignamos el nuevo SRC
        lightboxImg.src = currentGalleryImages[currentGalleryIndex];
        
        // 2. Usamos el evento 'onload' de la imagen
        lightboxImg.onload = () => {
            // A. La imagen cargó, guardamos sus dimensiones SEGURAS
            imageNaturalSize = { width: lightboxImg.naturalWidth, height: lightboxImg.naturalHeight };
            
            // B. Esperamos a que el navegador esté listo para dibujar
            requestAnimationFrame(() => {
                // C. AHORA SÍ: Calculamos el zoom y la mostramos
                resetImageTransform();
                lightboxImg.style.opacity = 1;
            });
        };
        
        // 3. (Opcional) Manejo de error si la imagen no carga
        lightboxImg.onerror = () => {
             console.error("Error: No se pudo cargar la imagen", lightboxImg.src);
             // (Aquí podríamos mostrar un mensaje de error, pero por ahora solo lo logueamos)
        }

        // 4. Mostramos/ocultamos flechas (esto es rápido)
        galleryPrev.style.display = (currentGalleryIndex > 0) ? 'block' : 'none';
        galleryNext.style.display = (currentGalleryIndex < currentGalleryImages.length - 1) ? 'block' : 'none';
    }
    
    // ▲▲ FIN DE LA CORRECCIÓN V8 ▲▲
    
    
    // NAVEGACIÓN (Sin cambios)
    galleryPrev.addEventListener('click', (e) => {
        e.stopPropagation(); 
        showGalleryImage(currentGalleryIndex - 1);
    });

    galleryNext.addEventListener('click', (e) => {
        e.stopPropagation(); 
        showGalleryImage(currentGalleryIndex + 1);
    });
    
    // ABRIR GALERÍA (Sin cambios)
    function openGallery(images, startIndex) {
        if (mainNavBar) {
            mainNavBar.style.display = 'none';
        }
        currentGalleryImages = images;
        lightbox.style.display = 'flex';
        zoomToolbar.style.display = 'flex'; 
        chatContainer.classList.remove('open');
        showGalleryImage(startIndex);
    }
    
    // --- EVENT LISTENERS PARA PAN & ZOOM (Sin cambios) ---

    // Botón +
    zoomInBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentZoom = Math.min(currentZoom + ZOOM_STEP, MAX_ZOOM);
        updateImageTransform();
    });

    // Botón -
    zoomOutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentZoom = Math.max(currentZoom - ZOOM_STEP, fitZoom);
        
        if (currentZoom === fitZoom) {
            currentPan = { x: 0, y: 0 };
        }
        updateImageTransform();
    });
    
    // Arrastrar para Pan (Mover)
    lightboxImg.addEventListener('mousedown', (e) => {
        e.preventDefault(); 
        
        if (currentZoom > fitZoom) {
            isDragging = true;
            startPan.x = e.clientX - currentPan.x; 
            startPan.y = e.clientY - currentPan.y;
            lightboxImg.style.cursor = 'grabbing';
        }
    });
    
    imageWrapper.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        currentPan.x = e.clientX - startPan.x;
        currentPan.y = e.clientY - startPan.y;
        updateImageTransform(); 
    });

    imageWrapper.addEventListener('mouseup', () => {
        isDragging = false;
        if (currentZoom > fitZoom) {
            lightboxImg.style.cursor = 'grab';
        } else {
            lightboxImg.style.cursor = 'default';
        }
    });

    imageWrapper.addEventListener('mouseleave', () => {
        isDragging = false;
        if (currentZoom > fitZoom) {
            lightboxImg.style.cursor = 'grab';
        } else {
            lightboxImg.style.cursor = 'default';
        }
    });


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

    // --- FUNCIÓN CENTRAL PARA MOSTRAR MENSAJES DEL BOT (Sin cambios) ---
    function showBotMessage(text, mediaUrl = null) {
        const botMessageElement = document.createElement('div');
        botMessageElement.classList.add('bot-message');

        let formattedText = text.replace(/(?<!http:|https:)\/\//g, '<br><br>');
        
        const urlRegex = /(https?:\/\/[^\s]+)/g;
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


