const { google } = require('googleapis');

// --- Configuración de Autenticación ---
function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsAPI(auth) {
  return google.sheets({ version: 'v4', auth });
}

// --- Función para extraer la fila (CORREGIDA) ---
function getRowFromRange(range) {
  // Busca el número de fila (ej. A6:G6 -> 6)
  const match = range.match(/![A-Z]+(\d+):?/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  throw new Error('No se pudo extraer el número de fila del rango: ' + range);
}

// --- Handler Principal de Netlify ---
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { action, data, row } = JSON.parse(event.body);
    const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;

    if (!spreadsheetId) {
      throw new Error('El ID de la hoja de Mantenimiento no está configurado.');
    }

    const auth = getAuth();
    const sheets = getSheetsAPI(auth);

    // --- ACCIÓN 1: ABRIR REPORTE ---
    if (action === 'abrir') {
      // data = [fecha, area, maquina, estacion, operador, status, workOrder]
      // Escribe en A:G
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: spreadsheetId,
        
        // ===== ESTA ES LA LÍNEA CORREGIDA =====
        // Le decimos a Google que simplemente agregue los datos al final
        // de la pestaña "Hoja 1", comenzando en la columna A.
        range: 'Hoja 1!A1', 
        // ======================================

        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [data],
        },
      });

      const updatedRange = response.data.updates.updatedRange;
      const newRow = getRowFromRange(updatedRange);

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Paro registrado.', row: newRow }),
      };
    }
    
    // --- ACCIÓN 2: REGISTRAR LLEGADA DE MECÁNICO ---
    else if (action === 'llegada') {
      // data = [fechaLlegada]
      // Escribe en J
      if (!row) throw new Error("Se requiere 'row' para la acción 'llegada'.");

      const updateRange = `Hoja 1!J${row}`; // Columna J
      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId,
        range: updateRange,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [data], // data es [fechaLlegada]
        },
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Llegada registrada.' }),
      };
    }

    // --- ACCIÓN 3: CERRAR REPORTE (SOLUCIÓN) ---
    else if (action === 'cerrar') {
      // data = [solucion, mecanico, fechaCierre]
      // Escribe en H, I, y K
      if (!row) throw new Error("Se requiere 'row' para la acción 'cerrar'.");

      // Usamos batchUpdate para escribir en rangos no contiguos
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: spreadsheetId,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: [
            {
              // Rango 1: Solucion y Mecanico (Columnas H e I)
              range: `Hoja 1!H${row}:I${row}`,
              values: [[ data[0], data[1] ]] // [solucion, mecanico]
            },
            {
              // Rango 2: Fecha de cierre (Columna K)
              range: `Hoja 1!K${row}`,
              values: [[ data[2] ]] // [fechaCierre]
            }
          ]
        }
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Paro finalizado y actualizado.' }),
      };
    } 
    
    // --- Error si la acción no es válida ---
    else {
      throw new Error('Acción no válida. Debe ser "abrir", "llegada" o "cerrar".');
    }

  } catch (error) {
    console.error('Error en la función de Mantenimiento:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error al procesar la solicitud: ' + error.message }),
    };
  }
};