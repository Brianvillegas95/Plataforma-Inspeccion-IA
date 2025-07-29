const { google } = require('googleapis');

exports.handler = async function (event) {
  // Solo permite peticiones de tipo POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Extrae los datos enviados desde la página HTML
    const { datos } = JSON.parse(event.body);

    // Se autentica con Google usando las credenciales seguras (que configuraremos después)
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Agrega la nueva fila a la hoja de cálculo
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'Hoja 1', // Se agregará al final de la "Hoja1"
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [datos], // Los datos deben ser un arreglo, ej: ['dato1', 'dato2']
      },
    });

    // Envía una respuesta de éxito
    return {
      statusCode: 200,
      body: JSON.stringify({ message: '¡Fila agregada con éxito!' }),
    };
  } catch (error) {
    console.error('Error:', error);
    // Envía una respuesta de error si algo falla
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error al escribir en la hoja.' }),
    };
  }
};