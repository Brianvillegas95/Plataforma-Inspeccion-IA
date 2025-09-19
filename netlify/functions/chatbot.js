// Archivo: netlify/functions/chatbot.js (versión con googleapis)

const { google } = require('googleapis');

const { GOOGLE_SHEET_ID_CHATBOT, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;

exports.handler = async function(event) {
  const { id } = event.queryStringParameters;

  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta el parámetro ID' }) };
  }

  try {
    // Configura la autenticación
    const auth = new google.auth.JWT(
      GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );

    const sheets = google.sheets({ version: 'v4', auth });

    // Obtiene todas las filas de la hoja (asumiendo que se llama 'Hoja 1')
    const responseData = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID_CHATBOT,
      range: 'Hoja 1', 
    });

    const rows = responseData.data.values;
    if (!rows || rows.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: 'La hoja está vacía.' }) };
    }

    const headers = rows[0]; // La primera fila son los encabezados
    const idColIndex = headers.indexOf('ID');

    // Busca la fila que coincide con el ID
    const dialogueRowData = rows.find(row => row[idColIndex] === id);

    if (!dialogueRowData) {
      return { statusCode: 404, body: JSON.stringify({ error: `No se encontró el ID ${id}` }) };
    }

    // Convierte la fila (array) en un objeto usando los encabezados
    const dialogueRow = headers.reduce((obj, header, index) => {
        obj[header] = dialogueRowData[index];
        return obj;
    }, {});

    const response = {
      message: dialogueRow['Texto del Mensaje'],
      options: []
    };

    for (let i = 1; i <= 6; i++) {
      const optionText = dialogueRow[`Opcion${i}_Texto`];
      const optionNextId = dialogueRow[`Opcion${i}_SiguienteID`];

      if (optionText && optionNextId) {
        response.options.push({ text: optionText, nextId: optionNextId });
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Error al conectar con Google Sheets:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno del servidor.' }) };
  }
};