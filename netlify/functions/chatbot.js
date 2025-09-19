// Archivo: netlify/functions/chatbot.js (versión con fuzzy search)

const { google } = require('googleapis');
const Fuse = require('fuse.js'); // Importamos la librería de búsqueda

// ... (El resto de tus variables de entorno)
const { GOOGLE_SHEET_ID_CHATBOT, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;

function sheetsArrayToObject(rows) { /* ... (esta función se mantiene igual que antes) ... */ }

exports.handler = async function(event) {
    const { id, query } = event.queryStringParameters;
    const currentId = id || '0';
    
    // ... (la autenticación con googleapis se mantiene igual que antes) ...

    // --- LÓGICA PRINCIPAL ---
    try {
        // ... (el código para leer las dos hojas se mantiene igual) ...

        // SI LLEGA UNA BÚSQUEDA DE TEXTO (query)
        if (query) {
            const subCategorias = categorias.filter(cat => (currentId === '0') ? !cat.id_padre : cat.id_padre === currentId);
            
            // Usamos Fuse.js para la búsqueda difusa
            const fuse = new Fuse(subCategorias, { keys: ['nombre'], threshold: 0.4 });
            const results = fuse.search(query);

            if (results.length > 0) {
                // Si encontramos una coincidencia, simulamos el clic
                const bestMatch = results[0].item;
                // Devolvemos el ID de la mejor coincidencia para que el frontend siga el flujo
                return { statusCode: 200, body: JSON.stringify({ followUpId: bestMatch.id_categoria }) };
            } else {
                // Si no hay coincidencias, avisamos al usuario
                return { statusCode: 200, body: JSON.stringify({ message: `No encontré resultados para "${query}". Por favor, intenta con otra palabra o usa los botones.`, options: [] }) };
            }
        }
        
        // El resto de la lógica (para clics en botones) se mantiene igual
        // 1. BUSCAR INFORMACIÓN FINAL
        // 2. BUSCAR SUBCATEGORÍAS
        // ...
    } catch (error) { /* ... (el manejo de errores se mantiene igual) ... */ }
};