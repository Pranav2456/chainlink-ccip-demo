import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import contractABI from './abi/CCIP.json';
import erc20ABI from './abi/ERC20.json';
import routerABI from './abi/Router.json';
import { Interface } from 'ethers/lib/utils';
import EVM2EVMOnRampAbi from './abi/EVM2EVMOnRamp.json'; 
import EVM2EVMOffRampAbi from './abi/EVM2EVMOffRamp.json';
import { getMessageStatus } from './messageStatus';

function getEvm2EvmMessage(receipt) {
  const evm2EvmOnRampInterface = new Interface(EVM2EVMOnRampAbi);

  const parsedLogs = receipt.logs.map(log => {
    try {
      return evm2EvmOnRampInterface.parseLog(log);
    } catch (error) {
      return null;
    }
  });

  // Filter out non-matching or invalid logs
  const matchingLogs = parsedLogs.filter(log => log && log.name === "CCIPSendRequested");

  // Extract data from the first matching log (if any)
  if (matchingLogs.length > 0) {
    const firstMatchingLog = matchingLogs[0];
    const [
      sourceChainSelector,
      sender,
      receiver,
      sequenceNumber,
      gasLimitInWei, // Assuming gasLimit is in Wei
      strict,
      nonce,
      feeToken,
      feeTokenAmount,
      data,
      tokenAmountsRaw,
      sourceTokenDataRaw,
      messageId,
    ] = firstMatchingLog.args[0];

    const tokenAmounts = tokenAmountsRaw.map(([token, amount]) => ({
      token,
      amount,
    }));
    const sourceTokenData = sourceTokenDataRaw.map(data => data);

    const evm2EvmMessage = {
      sourceChainSelector,
      sender,
      receiver,
      sequenceNumber,
      gasLimitInWei,
      strict,
      nonce,
      feeToken,
      feeTokenAmount,
      data,
      tokenAmounts,
      sourceTokenData,
      messageId,
    };
    return evm2EvmMessage;
  } else {
    console.warn("No CCIPSendRequested logs found");
    return null;
  }

  return null; 
}

function App() {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferResult, setTransferResult] = useState(null);
  const [messageStatus, setMessageStatus] = useState(null);
  const [messageId, setMessageId] = useState(null);
  const [error, setError] = useState(null);

  const sepoliaContractAddress = "0x77f54e75ba8EB355bBb1586bFc20CD2Bd83f2Bc6";
  const arbSepoliaContractAddress = "0xc212DA7c53b29b1a8A546f941a36Af8828E12eCf";
  const ccipBnMTokenSepolia = "0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05";
  const ccipRouterAddressSepolia = "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59";
  const ccipRouterAddressArbSepolia = "0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165";
  const sepoliaProvider = new ethers.providers.JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/Y8rMH9-oKPNkA0yWyZG6xnZsF4MqLIQl');
  const arbSepoliaProvider = new ethers.providers.JsonRpcProvider('https://arb-sepolia.g.alchemy.com/v2/Y8rMH9-oKPNkA0yWyZG6xnZsF4MqLIQl');
  const arbitrumSepoliaChainSelector = "3478487238524512106";
  const sepoliaChainSelector = "16015286601757825753";

  const connectWallet = async () => {
    try {
      if (typeof window.ethereum !== 'undefined') {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send('eth_requestAccounts');
        const signer = provider.getSigner();
        const account = await signer.getAddress();
        setAccount(account);
        setProvider(provider);
      } else {
        setError('Please install MetaMask!');
      }
    } catch (error) {
      console.error(error);
      setError('Failed to connect wallet: ' + error.message);
    }
  };

  const sendMessagePayNative = async () => {
    if (!provider) return;
    try {
      const signer = provider.getSigner();
      const contract = new ethers.Contract(sepoliaContractAddress, contractABI, signer);
      const tokenContract = new ethers.Contract(ccipBnMTokenSepolia, erc20ABI, signer);
      const routerContract = new ethers.Contract(ccipRouterAddressSepolia, routerABI, signer);
      
      const amount = ethers.utils.parseEther(transferAmount);
        const approveTx = await tokenContract.approve("0x77f54e75ba8EB355bBb1586bFc20CD2Bd83f2Bc6", amount);
        await approveTx.wait();

      const tokenAmounts = [ {
        token: ccipBnMTokenSepolia,
        amount: amount
      },
      ];
      const gasLimitValue = 400_000n;
      const functionSelector = ethers.utils.id("CCIP EVMExtraArgsV1").slice(0, 10);
      const extraArgs = ethers.utils.defaultAbiCoder.encode(["uint256", "bool"], [gasLimitValue, true]);
      const encodedExtraArgs = `${functionSelector}${extraArgs.slice(2)}`;
      const message = {
        receiver: ethers.utils.defaultAbiCoder.encode(["address"], [arbSepoliaContractAddress]),
        data: ethers.utils.defaultAbiCoder.encode(["string"], [account]),
        tokenAmounts: tokenAmounts,
        feeToken: ethers.constants.AddressZero,
        extraArgs: encodedExtraArgs,
      };
      const fees = routerContract.getFee(arbitrumSepoliaChainSelector, message);

      const tx = await contract.sendMessagePayNative(
        arbitrumSepoliaChainSelector,
        arbSepoliaContractAddress,
        account,
        ccipBnMTokenSepolia,
        amount,
        { value: fees }
      );
      console.log("Transaction hash" , tx.hash);
      const receipt = await tx.wait();
      const evm2EvmMessage = getEvm2EvmMessage(receipt);
      setMessageId(evm2EvmMessage.messageId);
      setTransferResult(tx.hash);
    } catch (error) {
      console.error('Failed to send message:', error);
      setError('Failed to send message: ' + error.message);
    }
  }

  const fetchStatus = async () => {
    const sourceRouterContract = new ethers.Contract(
      ccipRouterAddressSepolia,
      routerABI,
      sepoliaProvider
  );

  const isChainSupported = await sourceRouterContract.isChainSupported(arbitrumSepoliaChainSelector);

  if (!isChainSupported) {
      throw new Error("Chain is not supported");
  }

  const destinationRouterContract = new ethers.Contract(
      ccipRouterAddressArbSepolia,
      routerABI,
      arbSepoliaProvider
  );
  const offRamps = await destinationRouterContract.getOffRamps();
  const matchingOffRamps = offRamps.filter((offRamp) => offRamp.sourceChainSelector.toString() === sepoliaChainSelector);

  for (const matchingOffRamp of matchingOffRamps) {
      const offRampContract = new ethers.Contract(
          matchingOffRamp.offRamp,
          EVM2EVMOffRampAbi,
          arbSepoliaProvider
      );

      const events = await offRampContract.queryFilter(
          offRampContract.filters.ExecutionStateChanged(undefined, messageId),

      );

      if(events.length > 0) {
          const { state } = events[0].args;
          const status = getMessageStatus(state);
          setMessageStatus(status);
      } else {
          setMessageStatus(`Either the message ${messageId} does not exist or it has not been processed yet on destination chain`);
      }
  } 
  };

  return (
    <div>
      <button onClick={connectWallet}>Connect Wallet</button>
      {account ? (
        <div>
          Connected to: {account}<br />
          A bridge for bridging funds from Ethereum Sepolia to Arbitrum Sepolia using Chainlink CCIP.<br />
          <input type="text" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} /><br />
          <button onClick={sendMessagePayNative}>BRIDGE TOKEN</button><br />
          {transferResult && <p>Message Id: {messageId}</p>}< br />
          It takes around 20 minutes to confirm the bridging process. Check the status by clicking on the "Fetch Status" button<br />
          <button onClick={fetchStatus}>Fetch Status</button>< br />
          {messageStatus && <p>Status: {messageStatus}</p>}<br />
        </div>
      ) : (
        <p>Please connect your wallet</p>
      )}
      {error && <p style={{color: 'red'}}>{error}</p>}
    </div>
  );
};

export default App;