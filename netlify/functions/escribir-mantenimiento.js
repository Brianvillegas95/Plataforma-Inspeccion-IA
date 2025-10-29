const { google } = require('googleapis');

// Función de autenticación (igual que en tu otro archivo)
function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// Función para obtener la API de Google Sheets
function getSheetsAPI(auth) {
  return google.sheets({ version: 'v4', auth });
}

// Extraer el número de fila de la respuesta de 'append'
// La respuesta es algo como "'Hoja 1'!A10:E10"
function getRowFromRange(range) {
  const match = range.match(/!A(\d+):/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  // Fallback por si el rango es diferente
  const simpleMatch = range.match(/!A(\d+)/);
   if (simpleMatch && simpleMatch[1]) {
    return parseInt(simpleMatch[1], 10);
  }
  throw new Error('No se pudo extraer el número de fila del rango: ' + range);
}


exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { action, data, row } = JSON.parse(event.body);

    // Validamos que tengamos el ID de la hoja de Mantenimiento
    const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
    if (!spreadsheetId) {
      throw new Error('El ID de la hoja de Mantenimiento no está configurado en Netlify.');
    }

    const auth = getAuth();
    const sheets = getSheetsAPI(auth);

    // --- LÓGICA DE DOS ACCIONES ---

    if (action === 'abrir') {
      // Acción 1: Generar Paro (APPEND)
      // 'data' debe ser [fechaApertura, maquina, operador, area, workOrder]
      
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: spreadsheetId,
        range: 'Hoja 1!A1', // Apunta a la 'Hoja 1'
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [data],
        },
      });

      // Devolvemos el número de fila que se acaba de crear
      const updatedRange = response.data.updates.updatedRange;
      const newRow = getRowFromRange(updatedRange);

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Paro registrado.', row: newRow }),
      };

    } else if (action === 'cerrar') {
      // Acción 2: Finalizar Paro (UPDATE)
      // 'data' debe ser [solucion, mecanico, fechaCierre]
      // 'row' debe ser el número de fila a actualizar
      
      if (!row) {
        throw new Error("Se requiere un 'row' (número de fila) para la acción 'cerrar'.");
      }

      // El rango será F, G, H de la fila especificada
      const updateRange = `Hoja 1!F${row}:H${row}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId,
        range: updateRange,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [data],
        },
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Paro finalizado y actualizado.' }),
      };

    } else {
      throw new Error('Acción no válida. Debe ser "abrir" o "cerrar".');
    }

  } catch (error) {
    console.error('Error al escribir en la hoja de Mantenimiento:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error al procesar la solicitud: ' + error.message }),
    };
  }
};