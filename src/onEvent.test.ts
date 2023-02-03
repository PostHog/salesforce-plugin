import { PluginEvent } from '@posthog/plugin-scaffold'
import { onEvent, SalesforcePluginConfig, SalesforcePluginGlobal, SalesforcePluginMeta } from '.'

const mockBuffer = { add: jest.fn() }

describe('onEvent', () => {
    let config: SalesforcePluginConfig

    beforeEach(() => {
        mockBuffer.add.mockClear()

        config = {
            salesforceHost: 'https://example.io',
            eventPath: 'test',
            eventMethodType: 'test',
            username: 'test',
            password: 'test',
            consumerKey: 'test',
            consumerSecret: 'test',
            eventsToInclude: '$pageview',
            propertiesToInclude: '',
            eventEndpointMapping: '',
            debugLogging: '',
        }
    })

    it('throws an error if there is no buffer', async () => {
        const global = ({ buffer: undefined } as unknown) as SalesforcePluginGlobal

        expect(() =>
            onEvent({ event: 'test' } as PluginEvent, { global, config } as SalesforcePluginMeta)
        ).rejects.toThrowError('There is no buffer. Setup must have failed, cannot process event: test')
    })

    it('adds the event to the buffer with v1 mapping that matches', async () => {
        const global = ({ buffer: mockBuffer } as unknown) as SalesforcePluginGlobal
        config.eventsToInclude = 'test'

        await onEvent({ event: 'test' } as PluginEvent, { global, config } as SalesforcePluginMeta)

        expect(mockBuffer.add).toHaveBeenCalledWith({ event: 'test' }, 16)
    })

    it('skips the event with v1 mapping that does not match', async () => {
        const global = ({ buffer: mockBuffer } as unknown) as SalesforcePluginGlobal
        config.eventsToInclude = 'to match'

        await onEvent({ event: 'not to match' } as PluginEvent, { global, config } as SalesforcePluginMeta)

        expect(mockBuffer.add).not.toHaveBeenCalled()
    })

    it('adds the event to the buffer with v2 mapping that matches', async () => {
        const global = ({ buffer: mockBuffer } as unknown) as SalesforcePluginGlobal
        config.eventsToInclude = ''
        config.eventPath = ''
        config.eventEndpointMapping = JSON.stringify({ test: { salesforcePath: '/test', method: 'POST' } })

        await onEvent({ event: 'test' } as PluginEvent, { global, config } as SalesforcePluginMeta)

        expect(mockBuffer.add).toHaveBeenCalledWith({ event: 'test' }, 16)
    })

    it('skips the event with v2 mapping that does not match', async () => {
        const global = ({ buffer: mockBuffer } as unknown) as SalesforcePluginGlobal
        config.eventsToInclude = ''
        config.eventPath = ''
        config.eventEndpointMapping = JSON.stringify({ 'to match': { salesforcePath: '/test', method: 'POST' } })

        await onEvent({ event: 'not to match' } as PluginEvent, { global, config } as SalesforcePluginMeta)

        expect(mockBuffer.add).not.toHaveBeenCalled()
    })
})
