import { PluginEvent } from '@posthog/plugin-scaffold'
import { getProperties } from '.'

describe('filtering by property allow list', () => {
    describe('filtering', () => {
        it('does not filter if there is no allow list', () => {
            const properties = { a: 'a', b: 'b' }
            const filteredProperties = getProperties(({ properties } as unknown) as PluginEvent, '')
            expect(filteredProperties).toEqual(properties)
        })

        it('does filter if there is an allow list', () => {
            const properties = { a: 'a', b: 'b', c: 'c' }
            const filteredProperties = getProperties(({ properties } as unknown) as PluginEvent, 'a,c')
            expect(filteredProperties).toEqual({ a: 'a', c: 'c' })
        })

        it('copes with spaces in the config', () => {
            const properties = { a: 'a', b: 'b', c: 'c' }
            const filteredProperties = getProperties(({ properties } as unknown) as PluginEvent, 'a,   c')
            expect(filteredProperties).toEqual({ a: 'a', c: 'c' })
        })

        it('converts properties using field mappings', () => {
            const properties = { email: 'a', b: 'b', surname: 'c', d: 'e' }
            const filteredProperties = getProperties(
                ({ properties } as unknown) as PluginEvent, 'email,surname,d',
                { email: 'Email', surname: 'LastName' }
            )
            expect(filteredProperties).toEqual({ Email: 'a', LastName: 'c', d: 'e' })
        })

        it('can handle nested properties', () => {
            const properties = { email: 'a', top: {middle: {bottom:'val'}} }
            const filteredProperties = getProperties(
                ({ properties } as unknown) as PluginEvent,
                'top',
                {  } // TODO how do field mappings and nested properties interact
            )

            // TODO - I don't actually understand what nested properties are, could do with an example here 🙈
            expect(filteredProperties).toEqual('wat')
        })
    })
})
