const { google } = require('googleapis');

// --- Configuración de Autenticación (Sin cambios) ---
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
  if (!range) throw new Error('No se recibió un rango de la API de Google.');
  const match = range.match(/!([A-Z]+)(\d+)/);
  if (match && match[2]) {
    return parseInt(match[2], 10);
  }
  throw new Error(`No se pudo extraer el número de fila del rango: ${range}`);
}

async function checkForOpenDuplicate(sheets, area, maquina, estacion) {
  const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: produccionSheetId,
    range: 'Hoja 1!C2:N', 
  });
  const jobs = response.data.values || [];
  const normArea = area ? area.trim() : '';
  const normMaquina = maquina ? maquina.trim() : '';
  const normEstacion = estacion ? estacion.trim() : '';

  for (const job of jobs) {
    const jobArea = job[0] ? job[0].trim() : '';
    const jobMaquina = job[1] ? job[1].trim() : '';
    const jobEstacion = job[2] ? job[2].trim() : '';
    const jobStatus = job[11] ? job[11].trim() : '';
    if (jobArea === normArea && jobMaquina === normMaquina && jobEstacion === normEstacion &&
        (jobStatus === 'Asignado' || jobStatus === 'En Proceso' || jobStatus === 'En Cola')) {
      return true; 
    }
  }
  return false;
}

async function findMechanicByName(sheets, name) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const mecsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:E',
  });
  const mechanics = mecsResponse.data.values || [];
  for (let i = 0; i < mechanics.length; i++) {
    const dbName = mechanics[i][0] ? mechanics[i][0].trim() : '';
    const searchName = name ? name.trim() : '';
    if (dbName === searchName) {
      return {
        row: i + 2, name: mechanics[i][0], area: mechanics[i][1],
        availability: mechanics[i][2], 
        status: mechanics[i][3],
        TareaActual_RowID: mechanics[i][4]
      };
    }
  }
  return null;
}

async function findMechanicActiveJob(sheets, name) {
    const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
    const jobsResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: produccionSheetId,
        range: 'Hoja 1!M2:N',
    });
    const jobs = jobsResponse.data.values || [];
    for (let i = 0; i < jobs.length; i++) {
        const mecanicoAsignado = jobs[i][0];
        const statusParo = jobs[i][1];
        if (mecanicoAsignado === name && (statusParo === 'En Proceso' || statusParo === 'Asignado')) {
            return { row: i + 2, status: statusParo };
        }
    }
    return null;
}

async function getMechanicQueueCounts(sheets) {
    const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: produccionSheetId,
        range: 'Hoja 1!M2:N', 
    });
    const jobs = response.data.values || [];
    const queueCounts = {};
    for (const [mecanico, status] of jobs) {
        if (mecanico && status === 'En Cola') {
            queueCounts[mecanico] = (queueCounts[mecanico] || 0) + 1;
        }
    }
    return queueCounts;
}

// --- ¡FUNCIÓN 'findMechanicToAssign' MODIFICADA! ---
async function findMechanicToAssign(sheets, area) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const mecsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:E',
  });
  const mechanics = mecsResponse.data.values || [];
  
  // NOTA: 'getMechanicQueueCounts' y 'bestBusyMechanic'
  // ya no son necesarios para esta lógica, pero los dejamos
  // por si los quieres reactivar en el futuro.
  // const queueCounts = await getMechanicQueueCounts(sheets);
  
  let freeMechanic = null;
  // let bestBusyMechanic = null;
  // let minQueueCount = Infinity;
  
  const normArea = area ? area.trim() : '';
  for (let i = 0; i < mechanics.length; i++) {
    const [name, assignedArea, availability, systemStatus] = mechanics[i];
    const normAssignedArea = assignedArea ? assignedArea.trim() : '';
    
    if (normAssignedArea === normArea && availability === 'Disponible') {
        const isFree = (!systemStatus || systemStatus === 'Libre');
        
        if (isFree) {
            freeMechanic = { row: i + 2, name: name, area: assignedArea, status: 'Libre' };
            break; // Encontramos uno libre, es suficiente.
        }
        
        // Ya no nos importa encontrar al mejor ocupado
        /*
        if (systemStatus === 'Ocupado') {
            const currentQueueCount = queueCounts[name] || 0;
            if (currentQueueCount < minQueueCount) {
                minQueueCount = currentQueueCount;
                bestBusyMechanic = { row: i + 2, name: name, area: assignedArea, status: 'Ocupado' };
            }
        }
        */
    }
  }
  
  // --- ¡AQUÍ ESTÁ EL CAMBIO! ---
  // Ya no devolvemos 'bestBusyMechanic'.
  // Solo devolvemos un mecánico si está 'Libre'.
  return freeMechanic || null;
}

async function updateMechanicStatus(sheets, row, status, reportRowId) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!D${row}:E${row}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[status, reportRowId || '']],
    },
  });
}

async function updateMechanicAvailability(sheets, name, availability) {
  const mechanic = await findMechanicByName(sheets, name); 
  if (!mechanic) throw new Error(`Mecánico ${name} no encontrado en MECANICOS_DB.`);
  const activeJob = await findMechanicActiveJob(sheets, name);
  let newStatusSistema = 'Ocupado';
  if (availability === 'Disponible') {
      if (activeJob) {
          newStatusSistema = 'Ocupado';
      } else {
          newStatusSistema = 'Libre';
      }
  }
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!C${mechanic.row}:D${mechanic.row}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[availability, newStatusSistema]],
    },
  });
  mechanic.status = newStatusSistema;
  return mechanic;
}

async function findNextJobInSharedQueue(sheets, mechanicArea) {
  const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!C2:N', 
  });
  const jobs = response.data.values || [];
  let highPriorityJob = null;
  let lowPriorityJob = null;
  const normMechanicArea = mechanicArea ? mechanicArea.trim() : '';
  for (let i = 0; i < jobs.length; i++) {
    const row = i + 2;
    const jobArea = jobs[i][0]; 
    const jobStatusMaquina = jobs[i][4]; 
    const jobStatusParo = jobs[i][11]; 
    const normJobArea = jobArea ? jobArea.trim() : '';
    if (normJobArea === normMechanicArea && jobStatusParo === 'En Cola') {
      if (jobStatusMaquina === 'detenida' && !highPriorityJob) {
        highPriorityJob = { row: row };
        break; 
      }
      if (jobStatusMaquina === 'trabajando' && !lowPriorityJob) {
        lowPriorityJob = { row: row };
      }
    }
  }
  return highPriorityJob || lowPriorityJob;
}

async function reAssignPendingJob(sheets, mechanic, jobRow) {
  console.log(`RE-ASIGNACIÓN dinámica (al cerrar): ${mechanic.name} -> Fila ${jobRow}`);
  await updateMechanicStatus(sheets, mechanic.row, 'Ocupado', jobRow);
  const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!M${jobRow}:N${jobRow}`, 
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[mechanic.name, 'Asignado']], 
    },
  });
}

async function releaseMechanicAndCheckQueue(sheets, mechanicName) {
  if (!mechanicName || mechanicName === 'En Espera') return;
  const mechanic = await findMechanicByName(sheets, mechanicName.trim()); 
  if (!mechanic) {
      console.log(`Mecánico ${mechanicName} no encontrado en DB. No se puede liberar.`);
      return;
  }
  const nextJob = await findNextJobInSharedQueue(sheets, mechanic.area);
  if (nextJob) {
      console.log(`Mecánico ${mechanicName} liberado, RE-ASIGNANDO trabajo (Fila ${nextJob.row}).`);
      await reAssignPendingJob(sheets, mechanic, nextJob.row);
  } else {
      console.log(`Mecánico ${mechanicName} liberado. No hay trabajos en cola.`);
      await updateMechanicStatus(sheets, mechanic.row, 'Libre', '');
  }
}

async function assignFullQueueToMechanic(sheets, mechanic) {
    const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId,
        range: 'Hoja 1!A2:N',
    });
    const jobs = response.data.values || [];
    const pendingJobs = [];
    const normMechanicArea = mechanic.area ? mechanic.area.trim() : '';
    
    for (let i = 0; i < jobs.length; i++) {
        const row = i + 2;
        const [folio, , jobArea, maquina, estacion, , statusMaquina, , , , , , mecanicoAsignado, statusParo] = jobs[i];
        const normJobArea = jobArea ? jobArea.trim() : '';
        if (normJobArea === normMechanicArea && mecanicoAsignado === 'En Espera' && statusParo === 'En Cola') {
            pendingJobs.push({ row, statusMaquina });
        }
    }

    if (pendingJobs.length === 0) {
        console.log(`No hay trabajos "En Espera" para ${mechanic.name}.`);
        return;
    }

    pendingJobs.sort((a, b) => {
        if (a.statusMaquina === 'detenida' && b.statusMaquina !== 'detenida') return -1;
        if (a.statusMaquina !== 'detenida' && b.statusMaquina === 'detenida') return 1;
        return a.row - b.row;
    });

    console.log(`Asignando ${pendingJobs.length} trabajos "En Espera" a ${mechanic.name}.`);

    const firstJob = pendingJobs.shift(); 
    await updateMechanicStatus(sheets, mechanic.row, 'Ocupado', firstJob.row);
    await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId,
        range: `Hoja 1!M${firstJob.row}:N${firstJob.row}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[mechanic.name, 'Asignado']] },
    });
    console.log(`Tarea ${firstJob.row} (prioritaria) asignada como "Actual" a ${mechanic.name}.`);

    if (pendingJobs.length > 0) {
        const dataForBatchUpdate = pendingJobs.map(job => ({
            range: `Hoja 1!M${job.row}`,
            values: [[mechanic.name]],
        }));
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: spreadsheetId,
            resource: {
                valueInputOption: 'USER_ENTERED',
                data: dataForBatchUpdate
            }
        });
        console.log(`${pendingJobs.length} tareas restantes asignadas a la "Cola Personal" de ${mechanic.name}.`);
    }
}


// --- Handler Principal ---
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  try {
    const { action, data, row, name } = JSON.parse(event.body);
    if (!action) {
       return { statusCode: 400, body: JSON.stringify({ error: 'Falta "action".' }) };
    }
    const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
    if (!produccionSheetId) {
      throw new Error('MANTENIMIENTO_SHEET_ID no está configurado.');
    }
    const auth = getAuth();
    const sheets = getSheetsAPI(auth);
    
    switch (action) {
      
      case 'abrir': {
        if (!data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "data".' }) };
        const [fechaApertura, areaDelParo, maquinaDelParo, estacionDelParo, operador, statusMaquina, workOrder] = data;

        const isDuplicate = await checkForOpenDuplicate(sheets, areaDelParo, maquinaDelParo, estacionDelParo);
        if (isDuplicate) {
            console.log(`BLOQUEADO: Intento de duplicar paro para ${maquinaDelParo}`);
            return { 
                statusCode: 409, 
                body: JSON.stringify({ error: 'Ya existe un reporte de paro activo para esta máquina.' }) 
            };
        }

        const now = new Date();
        const folio = `MAN-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        
        // Esta función ahora solo devuelve mecánicos "Libres"
        const mechanicToAssign = await findMechanicToAssign(sheets, areaDelParo);
        let statusParo;
        let mecanicoAsignado;
        
        if (mechanicToAssign) {
            // --- Flujo A: Encontramos un mecánico "Libre" ---
            statusParo = 'Asignado';
            mecanicoAsignado = mechanicToAssign.name;
            console.log(`Asignando a ${mechanicToAssign.name} (está Libre)`);

        } else {
            // --- Flujo B: NO hay mecánicos "Libres" ---
            // (Ya sea porque están 'Ocupados' o 'No Disponibles')
            console.log(`No hay mecánicos LIBRES para ${areaDelParo}. Poniendo "En Espera".`);
            statusParo = 'En Cola';
            mecanicoAsignado = 'En Espera';
        }
        
        const dataToWrite = [ folio, ...data, '', '', '', '', mecanicoAsignado, statusParo ];
        const response = await sheets.spreadsheets.values.append({
          spreadsheetId: produccionSheetId,
          range: 'Hoja 1!A1',
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [dataToWrite] },
        });

        const newRow = getRowFromRange(response.data.updates.updatedRange);
        
        // Solo actualizamos al mecánico si le asignamos el trabajo (Flujo A)
        if (mechanicToAssign) {
            await updateMechanicStatus(sheets, mechanicToAssign.row, 'Ocupado', newRow);
        }
        
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            row: newRow, 
            status: statusParo,
            mecanico: mecanicoAsignado,
            folio: folio
          }),
        };
      }
      
      case 'cerrar': {
        if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "data".' }) };
        const nombreMecanicoFormulario = data[1]; 
        const getResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: produccionSheetId,
            range: `Hoja 1!M${row}`,
        });
        const mecanicoAsignadoOriginal = getResponse.data.values ? getResponse.data.values[0][0] : null;
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: produccionSheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
              { range: `Hoja 1!I${row}:J${row}`, values: [[ data[0], nombreMecanicoFormulario ]] }, 
              { range: `Hoja 1!L${row}`, values: [[ data[2] ]] }, 
              { range: `Hoja 1!N${row}`, values: [['Cerrado']] } 
            ]
          }
        });
        if (mecanicoAsignadoOriginal && mecanicoAsignadoOriginal !== 'En Espera') {
            console.log(`Liberando al mecánico original: ${mecanicoAsignadoOriginal}`);
            await releaseMechanicAndCheckQueue(sheets, mecanicoAsignadoOriginal);
        } else {
             console.log(`Fila ${row} cerrada sin un mecánico original que liberar.`);
        }
        return { statusCode: 200, body: JSON.stringify({ message: 'Paro finalizado.' }) };
      }
      
      case 'mecanico_check_in': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        const mechanic = await updateMechanicAvailability(sheets, name, 'Disponible');
        if (mechanic.status === 'Libre') {
            console.log(`Mecánico ${name} está libre, asignando cola completa "En Espera"...`);
            await assignFullQueueToMechanic(sheets, mechanic);
        } else {
            console.log(`Mecánico ${name} hizo check-in pero ya está ${mechanic.status}.`);
        }
        return { statusCode: 200, body: JSON.stringify({ message: `Mecánico ${name} check-in.` }) };
      }

      case 'llegada': {
        if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "data".' }) };
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: produccionSheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
              { range: `Hoja 1!K${row}`, values: [data] }, 
              { range: `Hoja 1!N${row}`, values: [['En Proceso']] } 
            ]
          }
        });
        return { statusCode: 200, body: JSON.stringify({ message: 'Llegada registrada.' }) };
      }

      case 'escalar_paro': {
        if (!row) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row".' }) };
        console.log(`Escalando Fila ${row} a "detenida"`);
        await sheets.spreadsheets.values.update({
          spreadsheetId: produccionSheetId,
          range: `Hoja 1!G${row}`,
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: [['detenida']]
          },
        });
        return { statusCode: 200, body: JSON.stringify({ message: 'Paro escalado a DETENIDA.' }) };
      }

      case 'check_status': {
        if (!row) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row".' }) };
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: produccionSheetId,
          range: `Hoja 1!M${row}:N${row}`, 
        });
        if (!response.data.values || !response.data.values[0]) {
          throw new Error(`No se encontraron datos para la fila ${row}`);
        }
        const [mecanico, status] = response.data.values[0];
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            mecanico: mecanico || 'N/A',
            status: status || 'Abierto' 
          }),
        };
      }
      case 'mecanico_check_out': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        await updateMechanicAvailability(sheets, name, 'No Disponible');
        return { statusCode: 200, body: JSON.stringify({ message: `Mecánico ${name} check-out.` }) };
      }
      case 'get_mecanico_tareas': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        let tareaActual = null;
        const tareasEnCola = [];
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: produccionSheetId,
          range: 'Hoja 1!A2:N', 
        });
        const jobs = response.data.values || [];
        for (let i = 0; i < jobs.length; i++) {
            const row = i + 2; 
            const [folio, , area, maquina, estacion, , statusMaquina, , , , , , mecanicoAsignado, statusParo] = jobs[i];
            if (mecanicoAsignado === name) {
                const tarea = { row, folio, area, maquina, estacion, statusParo, statusMaquina };
                if (statusParo === 'En Proceso') {
                    tareaActual = tarea;
                }
                else if (statusParo === 'Asignado') {
                    if (!tareaActual) {
                         tareaActual = tarea;
                    } else {
                         tareasEnCola.push(tarea);
                    }
                }
                else if (statusParo === 'En Cola') {
                    tareasEnCola.push(tarea);
                }
            }
        }
        tareasEnCola.sort((a, b) => {
            if (a.statusMaquina === 'detenida' && b.statusMaquina !== 'detenida') return -1;
            if (a.statusMaquina !== 'detenida' && b.statusMaquina === 'detenida') return 1;
            return a.row - b.row;
        });
        return { statusCode: 200, body: JSON.stringify({ tareaActual, tareasEnCola }) };
      }
      case 'get_mecanicos_activos': {
          const spreadsheetId = process.env.MECANICOS_SHEET_ID;
          if (!spreadsheetId) {
            throw new Error('MECANICOS_SHEET_ID no está configurado.');
          }
          const mecsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: 'Hoja 1!A2:C',
          });
          const mechanics = mecsResponse.data.values || [];
          const activos = mechanics
            .filter(mec => mec[0] && mec[2] === 'Disponible')
            .map(mec => mec[0]);
          return { statusCode: 200, body: JSON.stringify({ mecanicos: activos.sort() }) };
        }
      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Acción desconocida: "${action}".` }) };
    }
  } catch (error) {
    console.error('Error fatal en la función:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error al procesar la solicitud: ' + error.message }),
    };
  }
};