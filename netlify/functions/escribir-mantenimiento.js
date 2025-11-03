const { google } = require('googleapis');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Nota: No estamos leyendo 'action', 'row', etc.
    // Solo estamos recibiendo los datos del formulario.
    const { data } = JSON.parse(event.body);

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // ==== LA ÚNICA DIFERENCIA CON 'escribir-barras.js' ====
    const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
    // =======================================================
    
    if (!spreadsheetId) {
        throw new Error('El ID de la hoja de Mantenimiento no está configurado en Netlify.');
    }

    // Esta es la llamada "fire-and-forget" que SÍ funciona en tu otro archivo.
    // No usamos 'insertDataOption'.
    // No esperamos la respuesta para leer el 'updatedRange'.
    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: 'Hoja 1!A1', 
      valueInputOption: 'USER_ENTERED',
      resource: {
        // Usamos los 'datosDePrueba' de tu HTML de la prueba anterior
        values: [data],
      },
    });

    // Devolvemos un 'row' falso (999) para que el HTML piense que funcionó
    // y te muestre la pantalla de Andon.
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Prueba de escritura simple ejecutada.', row: 999 }),
    };
    
  } catch (error) {
    // Si esta prueba falla, ¡EL ERROR DEBE APARECER AQUÍ!
    console.error('ERROR EN LA PRUEBA DEFINITIVA:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Falló la prueba de escritura simple: ' + error.message }),
    };
  }
};