import { searchDestinations } from './src/pakeet.ts'
import { getSetting } from './src/db.ts'

const rows = await searchDestinations('13410')
for (const r of rows) console.log([r.id, r.subdistrict_name, r.district_name, r.city_name].join(' | '))
console.log('saved', await getSetting('pakeet_origin'))
