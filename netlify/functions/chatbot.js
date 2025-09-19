// Archivo: netlify/functions/chatbot.js

const { GoogleSpreadsheet } = require('google-spreadsheet');

// Estas son las credenciales que ya tienes configuradas en Netlify
const { GOOGLE_SHEET_ID_CHATBOT, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;

exports.handler = async function(event) {
  // Obtiene el ID que el frontend le envió (ej. ?id=1)
  const { id } = event.queryStringParameters;

  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta el parámetro ID' }) };
  }

  try {
    // Inicializa la conexión con la hoja de cálculo
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID_CHATBOT);
    await doc.useServiceAccountAuth({
      client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });

    // Carga la información del documento
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['Hoja 1']; // O el nombre exacto de tu hoja
    const rows = await sheet.getRows();

    // Busca la fila que corresponde al ID solicitado
    const dialogueRow = rows.find(row => row.ID === id);

    if (!dialogueRow) {
      return { statusCode: 404, body: JSON.stringify({ error: `No se encontró el ID ${id}` }) };
    }

    // Construye el objeto de respuesta en el formato que el frontend espera
    const response = {
      message: dialogueRow['Texto del Mensaje'],
      options: []
    };

    // Revisa dinámicamente si hay opciones (hasta 6) y las añade
    for (let i = 1; i <= 6; i++) {
      const optionText = dialogueRow[`Opcion${i}_Texto`];
      const optionNextId = dialogueRow[`Opcion${i}_SiguienteID`];
      
      if (optionText && optionNextId) {
        response.options.push({
          text: optionText,
          nextId: optionNextId
        });
      }
    }
    
    // Devuelve los datos al frontend
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Error al conectar con Google Sheets:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error interno del servidor al procesar la solicitud.' })
    };
  }
};