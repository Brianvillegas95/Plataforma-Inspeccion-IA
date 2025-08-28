const { google } = require('googleapis');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Los 'datos' vendrán desde tu aplicación de inspección de tapones
    const { datos } = JSON.parse(event.body);

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // ¡Importante! Usaremos una nueva variable de entorno para el ID de esta hoja
    const spreadsheetId = process.env.TAPON6800_SHEET_ID;
    if (!spreadsheetId) {
        throw new Error('El ID de la hoja de Tapon 6800 no está configurado en Netlify.');
    }

    // Escribimos en la pestaña "Hoja 1"
    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: 'Hoja 1!A1', 
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [datos],
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Registro de inspección de tapón guardado.' }),
    };
  } catch (error) {
    console.error('Error al escribir en la hoja de Tapon 6800:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error al escribir en la hoja de Tapon 6800.' }),
    };
  }
};