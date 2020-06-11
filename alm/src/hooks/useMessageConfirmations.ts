import { useStateProvider } from '../state/StateProvider'
import { TransactionReceipt } from 'web3-eth'
import { MessageObject } from '../utils/web3'
import { useEffect, useState } from 'react'
import Web3 from 'web3'
import { Contract, EventData } from 'web3-eth-contract'
import { getAffirmationsSigned, getMessagesSigned } from '../utils/contract'
import {
  CONFIRMATIONS_STATUS,
  FOREIGN_RPC_POLLING_INTERVAL,
  HOME_RPC_POLLING_INTERVAL,
  VALIDATOR_CONFIRMATION_STATUS
} from '../config/constants'
import validatorsCache from '../services/ValidatorsCache'

export interface useMessageConfirmationsParams {
  message: MessageObject
  receipt: Maybe<TransactionReceipt>
  fromHome: boolean
}

export interface ConfirmationParam {
  validator: string
  status: string
}

export interface ExecutionData {
  status: string
  validator: string
  txHash: string
  timestamp: number
  executionResult: boolean
}

export const useMessageConfirmations = ({ message, receipt, fromHome }: useMessageConfirmationsParams) => {
  const { home, foreign } = useStateProvider()
  const [confirmations, setConfirmations] = useState<Array<ConfirmationParam>>([])
  const [status, setStatus] = useState(CONFIRMATIONS_STATUS.UNDEFINED)
  const [signatureCollected, setSignatureCollected] = useState(false)
  const [executionData, setExecutionData] = useState<ExecutionData>({
    status: VALIDATOR_CONFIRMATION_STATUS.UNDEFINED,
    validator: '',
    txHash: '',
    timestamp: 0,
    executionResult: false
  })

  useEffect(
    () => {
      const subscriptions: Array<number> = []

      const unsubscribe = () => {
        subscriptions.forEach(s => {
          clearTimeout(s)
        })
      }

      const confirmationContractMethod = fromHome ? getMessagesSigned : getAffirmationsSigned

      const getConfirmationsForTx = async (
        messageData: string,
        web3: Maybe<Web3>,
        validatorList: string[],
        bridgeContract: Maybe<Contract>,
        confirmationContractMethod: Function,
        setResult: Function,
        requiredSignatures: number,
        setSignatureCollected: Function
      ) => {
        if (!web3 || !validatorList || !bridgeContract) return
        const hashMsg = web3.utils.soliditySha3Raw(messageData)
        let validatorConfirmations = await Promise.all(
          validatorList.map(async validator => {
            const hashSenderMsg = web3.utils.soliditySha3Raw(validator, hashMsg)

            const signatureFromCache = validatorsCache.get(hashSenderMsg)
            if (signatureFromCache) {
              return {
                validator,
                status: VALIDATOR_CONFIRMATION_STATUS.SUCCESS
              }
            }

            const confirmed = await confirmationContractMethod(bridgeContract, hashSenderMsg)
            const status = confirmed ? VALIDATOR_CONFIRMATION_STATUS.SUCCESS : VALIDATOR_CONFIRMATION_STATUS.UNDEFINED

            // If validator confirmed signature, we cache the result to avoid doing future requests for a result that won't change
            if (confirmed) {
              validatorsCache.set(hashSenderMsg, confirmed)
            }

            return {
              validator,
              status
            }
          })
        )

        const successConfirmations = validatorConfirmations.filter(
          c => c.status === VALIDATOR_CONFIRMATION_STATUS.SUCCESS
        )

        // If signatures not collected, it needs to retry in the next blocks
        if (successConfirmations.length !== requiredSignatures) {
          const timeoutId = setTimeout(
            () =>
              getConfirmationsForTx(
                messageData,
                web3,
                validatorList,
                bridgeContract,
                confirmationContractMethod,
                setResult,
                requiredSignatures,
                setSignatureCollected
              ),
            HOME_RPC_POLLING_INTERVAL
          )
          subscriptions.push(timeoutId)
        } else {
          // If signatures collected, it should set other signatures as not required
          const notSuccessConfirmations = validatorConfirmations.filter(
            c => c.status !== VALIDATOR_CONFIRMATION_STATUS.SUCCESS
          )
          const notRequiredConfirmations = notSuccessConfirmations.map(c => ({
            validator: c.validator,
            status: VALIDATOR_CONFIRMATION_STATUS.NOT_REQUIRED
          }))

          validatorConfirmations = [...successConfirmations, ...notRequiredConfirmations]
          setSignatureCollected(true)
        }
        setResult(validatorConfirmations)
      }

      getConfirmationsForTx(
        message.data,
        home.web3,
        home.validatorList,
        home.bridgeContract,
        confirmationContractMethod,
        setConfirmations,
        home.requiredSignatures,
        setSignatureCollected
      )

      return () => {
        unsubscribe()
      }
    },
    [fromHome, message.data, home.web3, home.validatorList, home.bridgeContract, home.requiredSignatures]
  )

  useEffect(
    () => {
      const subscriptions: Array<number> = []

      const unsubscribe = () => {
        subscriptions.forEach(s => {
          clearTimeout(s)
        })
      }

      const contractEvent = fromHome ? 'RelayedMessage' : 'AffirmationCompleted'
      const bridgeContract = fromHome ? foreign.bridgeContract : home.bridgeContract
      const providedWeb3 = fromHome ? foreign.web3 : home.web3
      const pollingInterval = fromHome ? FOREIGN_RPC_POLLING_INTERVAL : HOME_RPC_POLLING_INTERVAL

      const getFinalizationEvent = async (
        contract: Maybe<Contract>,
        eventName: string,
        web3: Maybe<Web3>,
        setResult: React.Dispatch<React.SetStateAction<ExecutionData>>
      ) => {
        if (!contract || !web3) return
        const events: EventData[] = await contract.getPastEvents(eventName, {
          fromBlock: 0,
          toBlock: 'latest',
          filter: {
            messageId: message.id
          }
        })
        if (events.length > 0) {
          const event = events[0]
          const [txReceipt, block] = await Promise.all([
            web3.eth.getTransactionReceipt(event.transactionHash),
            web3.eth.getBlock(event.blockNumber)
          ])

          const blockTimestamp = typeof block.timestamp === 'string' ? parseInt(block.timestamp) : block.timestamp
          const validatorAddress = web3.utils.toChecksumAddress(txReceipt.from)

          setResult({
            status: VALIDATOR_CONFIRMATION_STATUS.SUCCESS,
            validator: validatorAddress,
            txHash: event.transactionHash,
            timestamp: blockTimestamp,
            executionResult: event.returnValues.status
          })
        } else {
          const timeoutId = setTimeout(
            () => getFinalizationEvent(contract, eventName, web3, setResult),
            pollingInterval
          )
          subscriptions.push(timeoutId)
        }
      }

      getFinalizationEvent(bridgeContract, contractEvent, providedWeb3, setExecutionData)

      return () => {
        unsubscribe()
      }
    },
    [fromHome, foreign.bridgeContract, home.bridgeContract, message.id, foreign.web3, home.web3]
  )

  useEffect(
    () => {
      if (executionData.txHash) {
        const newStatus = executionData.executionResult
          ? CONFIRMATIONS_STATUS.SUCCESS
          : CONFIRMATIONS_STATUS.SUCCESS_MESSAGE_FAILED
        setStatus(newStatus)
      } else if (signatureCollected) {
        setStatus(CONFIRMATIONS_STATUS.UNDEFINED)
      }
    },
    [executionData, signatureCollected]
  )

  return {
    confirmations,
    status,
    signatureCollected,
    executionData
  }
}
