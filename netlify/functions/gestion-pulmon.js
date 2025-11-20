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
        // Leemos hasta la columna G
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: inventarioSheetId,
          range: 'Hoja 1!A2:G', 
        });
        const rows = response.data.values || [];
        
        const inventario = rows.map((row, index) => ({
            row: index + 2, // Guardamos el número de fila real para usarlo en el retiro
            ID_Hueco: row[0] || null,
            Tamano_Hueco: row[1] || null,
            Estatus_Hueco: (row[2] || '').toUpperCase(), 
            Area_Destino: row[3] || null,
            OP_Tarima: row[4] || null,
            Tarima_Num: row[5] || null,
            Fecha_Entrada: row[6] || null,
        }));
            
        return { statusCode: 200, body: JSON.stringify({ inventario }) };
      }
      
      case 'buscar_huecos_disponibles_por_tamano': {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: inventarioSheetId,
          range: 'Hoja 1!A2:C', 
        });
        const rows = response.data.values || [];
        
        const disponibles = rows
            .map(row => ({
                ID_Hueco: row[0] || null,
                Tamano_Hueco: row[1] || 'CH', 
                Estatus_Hueco: (row[2] || '').toUpperCase(),
            }))
            .filter(h => h.Estatus_Hueco === 'DISPONIBLE' && h.ID_Hueco && !h.ID_Hueco.includes('PASILLO')) // No incluir pasillos dinámicos previos como disponibles
            .sort((a, b) => a.ID_Hueco.localeCompare(b.ID_Hueco));
            
        const huecosAgrupados = disponibles.reduce((acc, hueco) => {
            const tamano = hueco.Tamano_Hueco.toUpperCase();
            if (!acc[tamano]) acc[tamano] = [];
            acc[tamano].push(hueco.ID_Hueco);
            return acc;
        }, {});
            
        return { statusCode: 200, body: JSON.stringify({ huecos: huecosAgrupados }) };
      }

      case 'registrar_entrada': {
        if (!hueco || !op || !area || !tarimaNumStr) return { statusCode: 400, body: JSON.stringify({ error: 'Faltan datos de registro.' }) };
        
        // LÓGICA MIXTA: RACK FIJO vs PASILLO DINÁMICO
        if (hueco === 'PASILLO') {
            // --- REGISTRO EN PASILLO (Insertar nueva fila) ---
            // Generamos un ID único visual para el pasillo
            const idPasillo = `PASILLO-${op}-${Math.floor(Math.random() * 1000)}`;
            
            await sheets.spreadsheets.values.append({
                spreadsheetId: inventarioSheetId,
                range: 'Hoja 1!A1',
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: { 
                    // A:ID, B:Tam, C:Status, D:Area, E:OP, F:Num, G:Fecha
                    values: [[idPasillo, 'GR', 'OCUPADO', area, op, tarimaNumStr, now]] 
                },
            });

        } else {
            // --- REGISTRO EN RACK (Actualizar fila existente) ---
            const resInv = await sheets.spreadsheets.values.get({ spreadsheetId: inventarioSheetId, range: 'Hoja 1!A:A' });
            const rowIndex = (resInv.data.values || []).findIndex(row => row[0] === hueco);
            
            if (rowIndex === -1) return { statusCode: 404, body: JSON.stringify({ error: `Hueco ${hueco} no encontrado.` }) };
            const invRow = rowIndex + 1; 

            await sheets.spreadsheets.values.batchUpdate({
              spreadsheetId: inventarioSheetId,
              resource: {
                valueInputOption: 'USER_ENTERED',
                data: [
                  { range: `Hoja 1!C${invRow}`, values: [['OCUPADO']] },
                  { range: `Hoja 1!D${invRow}`, values: [[area]] },
                  { range: `Hoja 1!E${invRow}`, values: [[op]] },
                  { range: `Hoja 1!F${invRow}`, values: [[tarimaNumStr]] },
                  { range: `Hoja 1!G${invRow}`, values: [[now]] }
                ]
              }
            });
        }
        
        // 3. Registrar MOVIMIENTO (Trazabilidad) - Siempre se hace
        const movimientoData = ['', op, area, hueco, 'Entrada_Surtidor', now, '', '', tarimaNumStr]; 
        const resMov = await sheets.spreadsheets.values.append({
          spreadsheetId: movimientosSheetId,
          range: 'Hoja 1!A1',
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [movimientoData] },
        });
        const movRow = getRowFromRange(resMov.data.updates.updatedRange);
        
        await sheets.spreadsheets.values.update({
             spreadsheetId: movimientosSheetId,
             range: `Hoja 1!A${movRow}`,
             valueInputOption: 'USER_ENTERED',
             resource: { values: [[`SUP-${movRow}`]] },
        });

        return { statusCode: 200, body: JSON.stringify({ message: `Tarima de OP ${op} registrada.` }) };
      }
        
      case 'consultar_op': {
        if (!opBusqueda || !areaBusqueda) return { statusCode: 400, body: JSON.stringify({ error: 'Falta datos de búsqueda.' }) };
        
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: inventarioSheetId,
          range: 'Hoja 1!A2:G', 
        });
        const rows = response.data.values || [];
        const resultados = [];
        
        for (let i = 0; i < rows.length; i++) {
            const [idHueco, , estatusHueco, areaDestino, opTarima, tarimaNum, fechaEntrada] = rows[i];
            const normalizedEstatus = (estatusHueco || '').toUpperCase();
            
            if (opTarima === opBusqueda && areaDestino === areaBusqueda && normalizedEstatus === 'OCUPADO') {
                resultados.push({
                    row: i + 2, // Fila real
                    idHueco,
                    tarimaNum,
                    fechaEntrada
                });
            }
        }
        
        if (resultados.length === 0) {
            return { statusCode: 404, body: JSON.stringify({ message: `No se encontraron tarimas activas para OP ${opBusqueda}.` }) };
        }
        
        return { statusCode: 200, body: JSON.stringify({ resultados }) };
      }
        
      case 'solicitar_retiro': {
        if (!row || !op || !hueco || !tarimaNumStr || !area) return { statusCode: 400, body: JSON.stringify({ error: 'Faltan datos.' }) };
        
        // 1. Trazabilidad
        const movimientoData = ['', op, area, hueco, 'Solicitud_Supervisor', now, '', '', tarimaNumStr]; 
        const resMov = await sheets.spreadsheets.values.append({
            spreadsheetId: movimientosSheetId,
            range: 'Hoja 1!A1',
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: [movimientoData] },
        });
        const movRow = getRowFromRange(resMov.data.updates.updatedRange);
        await sheets.spreadsheets.values.update({
             spreadsheetId: movimientosSheetId, range: `Hoja 1!A${movRow}`,
             valueInputOption: 'USER_ENTERED', resource: { values: [[`SUP-${movRow}`]] },
        });

        // 2. Actualizar INVENTARIO
        // Si es un hueco de PASILLO (dinámico), lo ideal es BORRAR la fila para que no ensucie el visualizador.
        // Si es un hueco de RACK (fijo), solo limpiamos las celdas.
        
        if (hueco.includes('PASILLO')) {
             // Opción A: Borrar fila (más complejo por desplazamiento). 
             // Opción B: Marcar como RETIRADO/DISPONIBLE y limpiar datos (más seguro).
             // Usaremos la limpieza para evitar romper índices de filas concurrentes.
             // En el próximo get_inventario, se pueden filtrar si se desea, o simplemente dejar el hueco "desaparecer" si filtramos por OCUPADO.
             
             await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: inventarioSheetId,
                resource: {
                    valueInputOption: 'USER_ENTERED',
                    data: [
                        { range: `Hoja 1!C${row}`, values: [['RETIRADO']] }, // Marcamos como retirado
                        { range: `Hoja 1!D${row}:G${row}`, values: [['', '', '', '']] } 
                    ]
                }
            });
        } else {
            // Hueco Fijo
            await sheets.spreadsheets.values.batchUpdate({
              spreadsheetId: inventarioSheetId,
              resource: {
                valueInputOption: 'USER_ENTERED',
                data: [
                  { range: `Hoja 1!C${row}`, values: [['DISPONIBLE']] },
                  { range: `Hoja 1!D${row}:G${row}`, values: [['', '', '', '']] } 
                ]
              }
            });
        }

        return { statusCode: 200, body: JSON.stringify({ message: `Retiro solicitado.` }) };
      }
      
      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Acción desconocida.` }) };
    }
  } catch (error) {
    console.error('Error fatal:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error servidor: ' + error.message }) };
  }
};