// Ruta del archivo: netlify/functions/whatsapp-poc.js

const { google } = require('googleapis');
const axios = require('axios');

// --- Carga de variables de entorno ---
// Usamos el ID de tu sheet actual y las nuevas variables para WhatsApp
const {
    GOOGLE_SHEET_ID, // <-- Usamos tu variable existente
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY,
    WHATSAPP_TOKEN_POC,
    VERIFY_TOKEN_POC
} = process.env;

// --- LÓGICA PARA CONECTAR Y LEER GOOGLE SHEETS (La misma que ya funciona) ---
async function getSheetData() {
    const auth = new google.auth.JWT(
        GOOGLE_SERVICE_ACCOUNT_EMAIL, null,
        GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: GOOGLE_SHEET_ID, // <-- Usamos tu variable existente
        ranges: ['Categorias', 'Informacion'],
    });

    const [categoriasRows, informacionRows] = response.data.valueRanges;
    
    const sheetsArrayToObject = (rows) => {
        if (!rows || rows.length === 0) return [];
        const headers = rows[0];
        return rows.slice(1).map(row => {
            const rowObject = {};
            headers.forEach((header, index) => {
                rowObject[header] = row[index];
            });
            return rowObject;
        });
    };
    
    return {
        categorias: sheetsArrayToObject(categoriasRows.values),
        informacion: sheetsArrayToObject(informacionRows.values)
    };
}

// --- NUEVA LÓGICA PARA ENVIAR MENSAJES A WHATSAPP ---
async function sendWhatsAppMessage(to, message) {
    // IMPORTANTE: Revisa el ID de tu número de teléfono en el portal de Meta y asegúrate de que coincida aquí.
    const WHATSAPP_PHONE_NUMBER_ID = "262235957083650"; // <-- Este ID te lo da Meta en su portal.
    const whatsappApiUrl = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

    try {
        await axios.post(whatsappApiUrl, {
            messaging_product: 'whatsapp',
            to: to,
            ...message
        }, {
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN_POC}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error("Error al enviar mensaje:", error.response ? JSON.stringify(error.response.data) : error.message);
    }
}

// --- FUNCIÓN PRINCIPAL DE NETLIFY (EL WEBHOOK) ---
exports.handler = async function(event) {
    // Parte 1: Verificación del Webhook (solo se usa una vez al configurar)
    if (event.httpMethod === 'GET') {
        const queryParams = event.queryStringParameters;
        if (queryParams['hub.mode'] === 'subscribe' && queryParams['hub.verify_token'] === VERIFY_TOKEN_POC) {
            console.log("Webhook verificado!");
            return { statusCode: 200, body: queryParams['hub.challenge'] };
        }
        console.error("Fallo en la verificación del webhook.");
        return { statusCode: 403, body: 'Error de verificación.' };
    }

    // Parte 2: Recibir y Procesar Mensajes de Usuarios
    if (event.httpMethod === 'POST') {
        try {
            const body = JSON.parse(event.body);
            const messageData = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

            if (!messageData) return { statusCode: 200 };

            const from = messageData.from;
            const sheetData = await getSheetData();
            let currentId = '0';

            if (messageData.type === 'interactive' && messageData.interactive.type === 'button_reply') {
                currentId = messageData.interactive.button_reply.id;
            }

            const infoFinal = sheetData.informacion.find(item => item.id_categoria === currentId);

            if (infoFinal) {
                const textContent = infoFinal.contenido.replace(/\/\//g, '\n\n');
                const textMessage = { type: 'text', text: { body: textContent } };
                await sendWhatsAppMessage(from, textMessage);

                const backButtonMessage = {
                    type: 'interactive',
                    interactive: {
                        type: 'button', body: { text: '¿Necesitas algo más?' },
                        action: { buttons: [{ type: 'reply', reply: { id: '0', title: 'Ver menú principal' } }] }
                    }
                };
                await sendWhatsAppMessage(from, backButtonMessage);

            } else {
                const subCategorias = sheetData.categorias.filter(cat => cat.id_padre === currentId);
                if (subCategorias.length === 0) return { statusCode: 200 }; // No hay más opciones

                const buttons = subCategorias.slice(0, 3).map(subCat => ({ // WhatsApp solo permite 3 botones
                    type: 'reply', reply: { id: subCat.id_categoria, title: subCat.nombre }
                }));

                const pregunta = sheetData.categorias.find(cat => cat.id_categoria === currentId)?.pregunta || 'Selecciona una opción:';
                const optionsMessage = {
                    type: 'interactive',
                    interactive: {
                        type: 'button', body: { text: pregunta }, action: { buttons: buttons }
                    }
                };
                await sendWhatsAppMessage(from, optionsMessage);
            }
        } catch (error) {
            console.error("Error en el POST del webhook:", error);
        }
        return { statusCode: 200, body: 'Mensaje procesado.' };
    }

    return { statusCode: 405, body: 'Método no permitido.' };
};