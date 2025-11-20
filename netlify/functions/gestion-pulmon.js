// gestion-pulmon.js

const { google } = require('googleapis');

function getAuth() {
  const credentials = {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsAPI(auth) {
  return google.sheets({ version: 'v4', auth });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  try {
    const { action, hueco, op, area, tarimaNumStr, row, opBusqueda, areaBusqueda } = JSON.parse(event.body);

    const inventarioSheetId = process.env.SUP_INVENTARIO_SHEET_ID; 
    const movimientosSheetId = process.env.SUP_MOVIMIENTOS_SHEET_ID; 

    const auth = getAuth();
    const sheets = getSheetsAPI(auth);
    const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', hour12: false });

    switch (action) {
      
      case 'get_inventario': {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: inventarioSheetId,
          range: 'Hoja 1!A2:G', 
        });
        const rows = response.data.values || [];
        
        const inventario = rows.map((row, index) => ({
            row: index + 2,
            ID_Hueco: row[0] || null,
            Tamano_Hueco: row[1] || null,
            Estatus_Hueco: (row[2] || '').toUpperCase(), 
            Area_Destino: row[3] || '',
            OP_Tarima: row[4] || '',
            Tarima_Num: row[5] || '',
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
            .filter(h => h.Estatus_Hueco === 'DISPONIBLE' && h.ID_Hueco && !h.ID_Hueco.includes('PASILLO'))
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
        if (!hueco || !op || !area || !tarimaNumStr) return { statusCode: 400, body: JSON.stringify({ error: 'Faltan datos.' }) };
        
        // 1. Actualizar INVENTARIO
        if (hueco === 'PASILLO') {
            const idPasillo = `PASILLO-${Math.floor(Math.random() * 10000)}`;
            await sheets.spreadsheets.values.append({
                spreadsheetId: inventarioSheetId, range: 'Hoja 1!A1', valueInputOption: 'USER_ENTERED',
                resource: { values: [[idPasillo, 'GR', 'OCUPADO', area, op, tarimaNumStr, now]] },
            });
        } else {
            const resInv = await sheets.spreadsheets.values.get({ spreadsheetId: inventarioSheetId, range: 'Hoja 1!A:A' });
            const rowIndex = (resInv.data.values || []).findIndex(row => row[0] === hueco);
            if (rowIndex === -1) return { statusCode: 404, body: JSON.stringify({ error: `Hueco no encontrado.` }) };
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
        
        // 2. Registrar en MOVIMIENTOS (Nueva Fila de Entrada)
        // Cols: Folio, OP, Area, Hueco, Tarima_Num, Fecha_Entrada, Fecha_Salida(vacio)
        const folio = `MOV-${Date.now()}`;
        const movimientoData = [folio, op, area, hueco, tarimaNumStr, now, ""]; 
        
        await sheets.spreadsheets.values.append({
          spreadsheetId: movimientosSheetId,
          range: 'Hoja 1!A1',
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [movimientoData] },
        });

        return { statusCode: 200, body: JSON.stringify({ message: `Registrado correctamente.` }) };
      }
        
      case 'consultar_op': {
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: inventarioSheetId, range: 'Hoja 1!A2:G' });
        const rows = response.data.values || [];
        const resultados = [];
        
        for (let i = 0; i < rows.length; i++) {
            const [idHueco, , estatusHueco, areaDestino, opTarima, tarimaNum, fechaEntrada] = rows[i];
            if (opTarima === opBusqueda && (areaDestino === areaBusqueda) && (estatusHueco || '').toUpperCase() === 'OCUPADO') {
                resultados.push({ row: i + 2, idHueco, tarimaNum, fechaEntrada, areaDestino, opTarima });
            }
        }
        return { statusCode: 200, body: JSON.stringify({ resultados }) };
      }
        
      case 'solicitar_retiro': {
        if (!row || !op || !hueco) return { statusCode: 400, body: JSON.stringify({ error: 'Faltan datos.' }) };
        
        // 1. BUSCAR Y CERRAR CICLO EN MOVIMIENTOS
        // Buscamos en MOVIMIENTOS la fila que tenga esta OP, este Hueco y Fecha_Salida vacía.
        const movRes = await sheets.spreadsheets.values.get({ spreadsheetId: movimientosSheetId, range: 'Hoja 1!A2:G' });
        const movRows = movRes.data.values || [];
        let targetMovRow = -1;

        // Recorremos de atrás hacia adelante para encontrar el más reciente
        for (let i = movRows.length - 1; i >= 0; i--) {
            const r = movRows[i];
            // r[1]=OP, r[3]=Hueco, r[6]=Fecha_Salida
            if (r[1] === op && r[3] === hueco && (!r[6] || r[6] === "")) {
                targetMovRow = i + 2; // +2 por el header y el índice 0
                break;
            }
        }

        if (targetMovRow !== -1) {
            // Escribimos la fecha de salida en la columna G (índice 7 en notación A1 es G)
            await sheets.spreadsheets.values.update({
                spreadsheetId: movimientosSheetId,
                range: `Hoja 1!G${targetMovRow}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[now]] }
            });
        }

        // 2. LIBERAR EN INVENTARIO
        if (hueco.includes('PASILLO')) {
             // Limpiar fila de pasillo para que no salga en búsquedas
             await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: inventarioSheetId,
                resource: {
                    valueInputOption: 'USER_ENTERED',
                    data: [
                        { range: `Hoja 1!C${row}`, values: [['RETIRADO']] },
                        { range: `Hoja 1!D${row}:G${row}`, values: [['', '', '', '']] } 
                    ]
                }
            });
        } else {
            // Liberar hueco fijo
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

        return { statusCode: 200, body: JSON.stringify({ message: `Retirado y cerrado en historial.` }) };
      }
      
      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Acción desconocida.` }) };
    }
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Error servidor: ' + error.message }) };
  }
};