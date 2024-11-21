'use server'

import { db } from '@/drizzle/db'
import { SelectPokemon, pokemons } from '@/drizzle/schema'
import { openai } from '@/lib/openai'
import { desc, sql, cosineDistance, lt, asc } from 'drizzle-orm'
import { embed } from 'ai'

import fs from 'fs';
import path from 'path';

const saveSql = (query: any) => {
	const stringifyQuery = (query: string, params: unknown[]) => {
		let index = 1;
		return query.replace(/\$\d+/g, () => {
			const value = params[index - 1];
			index++;
			return `'${value}'`;
		});
	};

	const sql = query.toSQL();
	
	const sqlstr = stringifyQuery(sql.sql, sql.params)

	let usersPath = path.join(process.cwd(), 'sql.txt');
	fs.writeFileSync(usersPath, sqlstr);
	console.log('SQL written to:', usersPath);
}

export async function searchPokedex(
  query: string
): Promise<Array<Pick<SelectPokemon, 'id' | 'name'> & { similarity: number }>> {
  try {
    if (query.trim().length === 0) return []

    const embedding = await generateEmbedding(query)
    const vectorQuery = `[${embedding.join(',')}]`

    const similarity = sql<number>`${cosineDistance(
      pokemons.embedding,
      vectorQuery
    )}`

	const dbQuery = db
		.select({ id: pokemons.id, name: pokemons.name, similarity })
		.from(pokemons)
		.where(lt(similarity, 0.5))
		.orderBy((t) => asc(t.similarity))
		.limit(8)

	saveSql(dbQuery);

	const start = performance.now()

    const pokemon = await dbQuery;

    console.log('DB Search time:', performance.now() - start)

	// Check if index is used with EXPLAIN in postgres
	// Because the database is so small, postgres uses a seq scan instead of the index,
	// so disable the seq scan with SET SESSION enable_seqscan=false;

	// Original:
	// dragon: 189, volt: 192, magnet: 147
	// With index, but pg uses seq scan:
	// dragon: 240ms, volt: 263ms, magnet: 292ms
	// With index and seq scan disabled:
	// dragon: 161ms, volt: 280ms, magnet: 152ms

    return pokemon
  } catch (error) {
    console.error(error)
    throw error
  }
}

async function generateEmbedding(raw: string) {
  // OpenAI recommends replacing newlines with spaces for best results
  const input = raw.replace(/\n/g, ' ')
  const { embedding } = await embed({
    model: openai.embedding('text-embedding-ada-002'),
    value: input,
  })
  return embedding
}
