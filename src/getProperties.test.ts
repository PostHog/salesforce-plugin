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
    })
})
