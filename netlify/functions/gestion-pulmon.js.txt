// gestion-pulmon.js

const { google } = require('googleapis');

// --- Configuración de Autenticación ---
function getAuth() {
  const credentials = {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Error de configuración: Faltan credenciales.');
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsAPI(auth) {
  return google.sheets({ version: 'v4', auth });
}

function getRowFromRange(range) {
    if (!range) return null;
    const match = range.match(/!([A-Z]+)(\d+)/);
    if (match && match[2]) {
        return parseInt(match[2], 10);
    }
    return null;
}

// --- HANDLER PRINCIPAL ---
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  try {
    const { action, hueco, op, area, tarimaNumStr, row, opBusqueda, areaBusqueda } = JSON.parse(event.body);

    if (!process.env.SUP_INVENTARIO_SHEET_ID || !process.env.SUP_MOVIMIENTOS_SHEET_ID) {
        throw new Error('Faltan IDs de hoja de cálculo configurados.');
    }
    
    const auth = getAuth();
    const sheets = getSheetsAPI(auth);
    const inventarioSheetId = process.env.SUP_INVENTARIO_SHEET_ID; 
    const movimientosSheetId = process.env.SUP_MOVIMIENTOS_SHEET_ID; 

    const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', hour12: false });

    switch (action) {
      
      case 'get_inventario': {
        // Lee la hoja de INVENTARIO (A:G) para construir el Rack Virtual y la lista de disponibles.
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: inventarioSheetId,
          range: 'Hoja 1!A2:G', 
        });
        const rows = response.data.values || [];
        
        // CORRECCIÓN CRUCIAL: Mapeo robusto a 7 columnas (A-G)
        const inventario = rows.map(row => ({
            ID_Hueco: row[0] || null,
            Tamano_Hueco: row[1] || null,
            // Aseguramos que el estado esté en mayúsculas para la comparación en el frontend
            Estatus_Hueco: (row[2] && row[2].toUpperCase()) || 'DISPONIBLE', 
            Area_Destino: row[3] || null,
            OP_Tarima: row[4] || null,
            Tarima_Num: row[5] || null,
            Fecha_Entrada: row[6] || null,
        }));
            
        return { statusCode: 200, body: JSON.stringify({ inventario }) };
      }

      case 'registrar_entrada': {
        if (!hueco || !op || !area || !tarimaNumStr) return { statusCode: 400, body: JSON.stringify({ error: 'Faltan datos de registro.' }) };
        
        // 1. Encontrar la fila del hueco en INVENTARIO (Columna A).
        const resInv = await sheets.spreadsheets.values.get({ spreadsheetId: inventarioSheetId, range: 'Hoja 1!A:A' });
        const rowIndex = (resInv.data.values || []).findIndex(row => row[0] === hueco);
        if (rowIndex === -1) return { statusCode: 404, body: JSON.stringify({ error: `Hueco ${hueco} no encontrado en INVENTARIO DB.` }) };
        const invRow = rowIndex + 1; 

        // 2. Actualizar las columnas de registro en INVENTARIO (Rack Virtual)
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: inventarioSheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
              { range: `Hoja 1!C${invRow}`, values: [['OCUPADO']] }, // Estatus_Hueco (En mayúsculas)
              { range: `Hoja 1!D${invRow}`, values: [[area]] }, // Area_Destino
              { range: `Hoja 1!E${invRow}`, values: [[op]] }, // OP_Tarima
              { range: `Hoja 1!F${invRow}`, values: [[tarimaNumStr]] }, // Tarima_Num
              { range: `Hoja 1!G${invRow}`, values: [[now]] } // Fecha_Entrada
            ]
          }
        });
        
        // 3. Registrar MOVIMIENTO de Entrada (Trazabilidad)
        const movimientoData = ['', op, area, hueco, 'Entrada_Surtidor', now, '', '', tarimaNumStr]; 
        const resMov = await sheets.spreadsheets.values.append({
          spreadsheetId: movimientosSheetId,
          range: 'Hoja 1!A1',
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [movimientoData] },
        });
        const movRow = getRowFromRange(resMov.data.updates.updatedRange);
        
        // Asignar Folio_Mov (Columna A)
        await sheets.spreadsheets.values.update({
             spreadsheetId: movimientosSheetId,
             range: `Hoja 1!A${movRow}`,
             valueInputOption: 'USER_ENTERED',
             resource: { values: [[`SUP-${movRow}`]] },
        });

        return { statusCode: 200, body: JSON.stringify({ message: `Tarima de OP ${op} registrada en ${hueco}.` }) };
      }
        
      case 'consultar_op': {
        if (!opBusqueda || !areaBusqueda) return { statusCode: 400, body: JSON.stringify({ error: 'Falta la OP o el Área de búsqueda.' }) };
        
        // Buscar en INVENTARIO (el rack virtual) todas las tarimas de la OP/Área.
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: inventarioSheetId,
          range: 'Hoja 1!A2:G', 
        });
        const rows = response.data.values || [];
        const resultados = [];
        
        for (let i = 0; i < rows.length; i++) {
            const [idHueco, , estatusHueco, areaDestino, opTarima, tarimaNum, fechaEntrada] = rows[i];
            
            // Usamos .toUpperCase() para la comparación y evitar errores de capitalización
            const normalizedEstatus = (estatusHueco || '').toUpperCase();
            
            if (opTarima === opBusqueda && areaDestino === areaBusqueda && normalizedEstatus === 'OCUPADO') {
                resultados.push({
                    row: i + 2, // Fila real en la hoja de INVENTARIO
                    idHueco,
                    tarimaNum,
                    fechaEntrada
                });
            }
        }
        
        if (resultados.length === 0) {
            return { statusCode: 404, body: JSON.stringify({ message: `No se encontraron tarimas activas para OP ${opBusqueda} en ${areaBusqueda}.` }) };
        }
        
        return { statusCode: 200, body: JSON.stringify({ resultados }) };
      }
        
      case 'solicitar_retiro': {
        if (!row || !op || !hueco || !tarimaNumStr || !area) return { statusCode: 400, body: JSON.stringify({ error: 'Faltan datos para la solicitud.' }) };
        
        // 1. Registrar MOVIMIENTO de Solicitud (Trazabilidad)
        const movimientoData = ['', op, area, hueco, 'Solicitud_Supervisor', now, '', '', tarimaNumStr]; 
        
        const resMov = await sheets.spreadsheets.values.append({
            spreadsheetId: movimientosSheetId,
            range: 'Hoja 1!A1',
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: [movimientoData] },
        });
        const movRow = getRowFromRange(resMov.data.updates.updatedRange);

        // Asignar Folio_Mov 
        await sheets.spreadsheets.values.update({
             spreadsheetId: movimientosSheetId,
             range: `Hoja 1!A${movRow}`,
             valueInputOption: 'USER_ENTERED',
             resource: { values: [[`SUP-${movRow}`]] },
        });

        // 2. Limpiar y Liberar el hueco en INVENTARIO (Rack Virtual)
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: inventarioSheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
              { range: `Hoja 1!C${row}`, values: [['DISPONIBLE']] }, // Estatus_Hueco (En mayúsculas)
              // Limpiar Area_Destino, OP_Tarima, Tarima_Num, Fecha_Entrada
              { range: `Hoja 1!D${row}:G${row}`, values: [['', '', '', '']] } 
            ]
          }
        });

        return { statusCode: 200, body: JSON.stringify({ message: `Tarima ${tarimaNumStr} de OP ${op} solicitada y hueco ${hueco} liberado.` }) };
      }
      
      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Acción desconocida.` }) };
    }
  } catch (error) {
    console.error('Error fatal en la función:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error servidor: ' + error.message }) };
  }
};