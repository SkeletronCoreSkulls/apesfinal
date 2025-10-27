// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * X402Apes – ERC-721 tuned for x402 flow.
 * Only the OWNER (backend signer) can mint, and always to the payer.
 * EVM Paris compatible.
 */

import "https://cdn.jsdelivr.net/gh/OpenZeppelin/openzeppelin-contracts@v5.0.1/contracts/token/ERC721/ERC721.sol";
import "https://cdn.jsdelivr.net/gh/OpenZeppelin/openzeppelin-contracts@v5.0.1/contracts/access/Ownable.sol";
import "https://cdn.jsdelivr.net/gh/OpenZeppelin/openzeppelin-contracts@v5.0.1/contracts/utils/ReentrancyGuard.sol";
import "https://cdn.jsdelivr.net/gh/OpenZeppelin/openzeppelin-contracts@v5.0.1/contracts/utils/Pausable.sol";
import "https://cdn.jsdelivr.net/gh/OpenZeppelin/openzeppelin-contracts@v5.0.1/contracts/token/common/ERC2981.sol";
import "https://cdn.jsdelivr.net/gh/OpenZeppelin/openzeppelin-contracts@v5.0.1/contracts/utils/Strings.sol";

contract X402Apes is ERC721, ERC2981, Ownable, Pausable, ReentrancyGuard {
    using Strings for uint256;

    uint256 public maxSupply;
    uint256 public totalMinted;

    address public usdcToken;
    address public treasury;
    uint256 public priceUSDC;

    bool public mintEnabled = true;

    string private _baseTokenURI;
    string private _uriExtension = ".json";

    event MintExecuted(address indexed payer, uint256 quantity, uint256 firstTokenId);
    event PaymentContextUpdated(address usdc, address treasury, uint256 priceUSDC);
    event MintEnabledSet(bool enabled);
    event BaseURISet(string newBaseURI, string extension);
    event MaxSupplySet(uint256 newMaxSupply);

    error MintDisabled();
    error SoldOut();
    error QuantityZero();
    error MaxSupplyExceeded();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        string memory baseURI_,
        address initialOwner_,
        address usdcToken_,
        address treasury_,
        uint256 priceUSDC_,
        address royaltyReceiver_,
        uint96 royaltyFeeNumerator_
    )
        ERC721(name_, symbol_)
        Ownable(initialOwner_)
    {
        maxSupply = maxSupply_;
        _baseTokenURI = baseURI_;
        usdcToken = usdcToken_;
        treasury  = treasury_;
        priceUSDC = priceUSDC_;
        if (royaltyReceiver_ != address(0) && royaltyFeeNumerator_ > 0) {
            _setDefaultRoyalty(royaltyReceiver_, royaltyFeeNumerator_);
        }
    }

    function mintAfterPayment(address payer, uint256 quantity)
        external
        onlyOwner
        whenNotPaused
        nonReentrant
    {
        if (!mintEnabled) revert MintDisabled();
        if (quantity == 0) revert QuantityZero();
        if (totalMinted >= maxSupply) revert SoldOut();
        if (totalMinted + quantity > maxSupply) revert MaxSupplyExceeded();

        uint256 firstId = totalMinted + 1;
        for (uint256 i = 0; i < quantity; ) {
            _safeMint(payer, totalMinted + 1);
            unchecked { totalMinted++; i++; }
        }
        emit MintExecuted(payer, quantity, firstId);
    }

    function airdrop(address[] calldata recipients) external onlyOwner whenNotPaused nonReentrant {
        uint256 len = recipients.length;
        if (len == 0) revert QuantityZero();
        if (totalMinted + len > maxSupply) revert MaxSupplyExceeded();
        uint256 firstId = totalMinted + 1;
        for (uint256 i = 0; i < len; ) {
            _safeMint(recipients[i], totalMinted + 1);
            unchecked { totalMinted++; i++; }
        }
        emit MintExecuted(address(0), len, firstId);
    }

    function baseURI() external view returns (string memory) { return _baseTokenURI; }
    function uriExtension() external view returns (string memory) { return _uriExtension; }
    function getPaymentContext() external view returns (address usdc, address payTo, uint256 price) { return (usdcToken, treasury, priceUSDC); }
    function remainingSupply() external view returns (uint256) { return maxSupply - totalMinted; }

    function setMintEnabled(bool enabled) external onlyOwner { mintEnabled = enabled; emit MintEnabledSet(enabled); }
    function setPaymentContext(address usdc, address payToTreasury, uint256 priceUSDC_) external onlyOwner {
        usdcToken = usdc; treasury = payToTreasury; priceUSDC = priceUSDC_;
        emit PaymentContextUpdated(usdc, payToTreasury, priceUSDC_);
    }
    function setBaseURI(string calldata newBaseURI, string calldata extension) external onlyOwner {
        _baseTokenURI = newBaseURI; _uriExtension = extension; emit BaseURISet(newBaseURI, extension);
    }
    function setMaxSupply(uint256 newMaxSupply) external onlyOwner {
        require(newMaxSupply >= totalMinted, "cannot set below minted");
        maxSupply = newMaxSupply; emit MaxSupplySet(newMaxSupply);
    }
    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner { _setDefaultRoyalty(receiver, feeNumerator); }
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function renounceOwnership() public view override onlyOwner { revert("renounceOwnership disabled"); }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory base = _baseTokenURI;
        if (bytes(base).length == 0) return "";
        return string(abi.encodePacked(base, tokenId.toString(), _uriExtension));
    }
    function _baseURI() internal view override returns (string memory) { return _baseTokenURI; }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
