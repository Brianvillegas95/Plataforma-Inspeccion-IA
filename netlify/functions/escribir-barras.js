const { google } = require('googleapis');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { datos } = JSON.parse(event.body);

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Usamos la variable de entorno con el nombre que definiste
    const spreadsheetId = process.env.AUDITORIA_SHEETBARRAS_ID;
    if (!spreadsheetId) {
        throw new Error('El ID de la hoja de Auditoría no está configurado en Netlify.');
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      // Escribimos en la pestaña "Hoja 1" como en tu archivo
      range: 'Hoja 1!A1', 
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [datos],
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Registro de auditoría guardado.' }),
    };
  } catch (error) {
    console.error('Error al escribir en hoja de auditoría:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error al escribir en la hoja de auditoría.' }),
    };
  }
};