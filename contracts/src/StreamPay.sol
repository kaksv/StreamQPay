// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract StreamPay is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Stream {
        address sender;
        address recipient;
        uint256 deposit;
        uint256 withdrawn;
        uint64 startTime;
        uint64 endTime;
        uint64 cancelledAt;
        bool cancellable;
        bool cancelled;
    }

    error InvalidToken();
    error InvalidRecipient();
    error ZeroAmount();
    error InvalidDuration();
    error StreamNotFound();
    error Unauthorized();
    error NoWithdrawableAmount();
    error InvalidWithdrawalAmount();
    error NotCancellable();
    error AlreadyCancelled();
    error StreamEnded();
    error UnsupportedTokenBehavior();

    event StreamCreated(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        uint256 deposit,
        uint64 startTime,
        uint64 endTime,
        bool cancellable
    );
    event StreamWithdrawn(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint256 totalWithdrawn
    );
    event StreamCancelled(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        uint256 earned,
        uint256 refunded,
        uint64 cancelledAt
    );

    IERC20 public immutable token;
    uint256 public nextStreamId = 1;
    mapping(uint256 streamId => Stream stream) private streams;

    constructor(IERC20 token_) {
        if (address(token_).code.length == 0) revert InvalidToken();
        token = token_;
    }

    function createStream(address recipient, uint256 amount, uint64 duration, bool cancellable)
        external
        nonReentrant
        returns (uint256 streamId)
    {
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();
        if (duration == 0 || block.timestamp > type(uint64).max - duration) {
            revert InvalidDuration();
        }

        uint64 startTime = uint64(block.timestamp);
        uint64 endTime = startTime + duration;
        streamId = nextStreamId++;
        streams[streamId] = Stream({
            sender: msg.sender,
            recipient: recipient,
            deposit: amount,
            withdrawn: 0,
            startTime: startTime,
            endTime: endTime,
            cancelledAt: 0,
            cancellable: cancellable,
            cancelled: false
        });

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - balanceBefore != amount) {
            revert UnsupportedTokenBehavior();
        }

        emit StreamCreated(streamId, msg.sender, recipient, amount, startTime, endTime, cancellable);
    }

    function withdrawFromStream(uint256 streamId, uint256 amount) external nonReentrant {
        Stream storage stream = _getStream(streamId);
        if (msg.sender != stream.recipient) revert Unauthorized();
        if (amount == 0) revert ZeroAmount();

        uint256 available = _withdrawableAmount(stream);
        if (available == 0) revert NoWithdrawableAmount();
        if (amount > available) revert InvalidWithdrawalAmount();

        stream.withdrawn += amount;
        token.safeTransfer(stream.recipient, amount);
        emit StreamWithdrawn(streamId, stream.sender, stream.recipient, amount, stream.withdrawn);
    }

    function cancelStream(uint256 streamId) external nonReentrant {
        Stream storage stream = _getStream(streamId);
        if (msg.sender != stream.sender) revert Unauthorized();
        if (stream.cancelled) revert AlreadyCancelled();
        if (!stream.cancellable) revert NotCancellable();
        if (block.timestamp >= stream.endTime) revert StreamEnded();

        uint256 earned = _accruedAmount(stream);
        uint256 refund = stream.deposit - earned;
        stream.cancelled = true;
        stream.cancelledAt = uint64(block.timestamp);

        if (refund > 0) token.safeTransfer(stream.sender, refund);
        emit StreamCancelled(streamId, stream.sender, stream.recipient, earned, refund, stream.cancelledAt);
    }

    function accruedAmount(uint256 streamId) external view returns (uint256) {
        return _accruedAmount(_getStream(streamId));
    }

    function withdrawableAmount(uint256 streamId) external view returns (uint256) {
        return _withdrawableAmount(_getStream(streamId));
    }

    function getStream(uint256 streamId) external view returns (Stream memory) {
        return _getStream(streamId);
    }

    function _getStream(uint256 streamId) private view returns (Stream storage stream) {
        stream = streams[streamId];
        if (stream.sender == address(0)) revert StreamNotFound();
    }

    function _accruedAmount(Stream storage stream) private view returns (uint256) {
        if (block.timestamp <= stream.startTime) return 0;

        uint256 stopTime = stream.cancelled ? stream.cancelledAt : stream.endTime;
        uint256 effectiveTime = block.timestamp < stopTime ? block.timestamp : stopTime;
        if (effectiveTime <= stream.startTime) return 0;
        if (effectiveTime >= stream.endTime) return stream.deposit;

        return Math.mulDiv(stream.deposit, effectiveTime - stream.startTime, stream.endTime - stream.startTime);
    }

    function _withdrawableAmount(Stream storage stream) private view returns (uint256) {
        return _accruedAmount(stream) - stream.withdrawn;
    }
}
