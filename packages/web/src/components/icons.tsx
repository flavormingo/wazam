import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from 'react';
import {
  Hashtag,
  SoundHigh,
  Plus,
  SendDiagonal,
  Microphone,
  MicrophoneMute,
  Headset,
  Phone,
  PhoneIncome,
  PhoneOutcome,
  PhoneXmark,
  RotateCameraRight,
  Xmark,
  Group,
  Attachment,
  Computer,
  LogOut,
  Trash,
  EditPencil,
  Link,
  NavArrowLeft,
  NavArrowDown,
  VideoCamera,
  VideoCameraOff,
  MessageText,
  MultiBubble,
  UserPlus,
  UserXmark,
  Search,
  MapPin,
  Check,
  MediaImagePlus,
  Globe,
  Star,
  Spark,
  Flask,
  Emoji,
  Folder,
  Bell,
  BellOff,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Dribbble,
  Facebook,
  Github,
  Instagram,
  Linkedin,
  Medium,
  Pinterest,
  Snapchat,
  Telegram,
  Threads,
  Tiktok,
  Youtube,
  X,
} from 'iconoir-react';

interface IconProps {
  size?: number;
  className?: string;
}

type IconoirIcon = ForwardRefExoticComponent<
  Omit<SVGProps<SVGSVGElement>, 'ref'> & RefAttributes<SVGSVGElement>
>;

const icon = (Base: IconoirIcon) =>
  function Icon({ size = 20, className }: IconProps) {
    return (
      <Base
        width={size}
        height={size}
        strokeWidth={1.5}
        className={className ? `app-icon ${className}` : 'app-icon'}
      />
    );
  };

export const HashIcon = icon(Hashtag);
export const VolumeIcon = icon(SoundHigh);
export const PlusIcon = icon(Plus);
export const SendIcon = icon(SendDiagonal);
export const MicIcon = icon(Microphone);
export const MicMutedIcon = icon(MicrophoneMute);
export const HeadphonesIcon = icon(Headset);
export const PhoneIcon = icon(Phone);
export const PhoneIncomeIcon = icon(PhoneIncome);
export const PhoneOutcomeIcon = icon(PhoneOutcome);
export const PhoneXmarkIcon = icon(PhoneXmark);
export const RotateCameraIcon = icon(RotateCameraRight);
export const XIcon = icon(Xmark);
export const UsersIcon = icon(Group);
export const PaperclipIcon = icon(Attachment);
export const ScreenIcon = icon(Computer);
export const SignOutIcon = icon(LogOut);
export const TrashIcon = icon(Trash);
export const EditIcon = icon(EditPencil);
export const LinkIcon = icon(Link);
export const ChevronLeftIcon = icon(NavArrowLeft);
export const ChevronDownIcon = icon(NavArrowDown);
export const CameraIcon = icon(VideoCamera);
export const CameraOffIcon = icon(VideoCameraOff);
export const MessageTextIcon = icon(MessageText);
export const MultiBubbleIcon = icon(MultiBubble);
export const UserPlusIcon = icon(UserPlus);
export const UserXmarkIcon = icon(UserXmark);
export const SearchIcon = icon(Search);
export const LocationIcon = icon(MapPin);
export const CheckIcon = icon(Check);
export const ImageUploadIcon = icon(MediaImagePlus);
export const GlobalLinkIcon = icon(Globe);
export const StarIcon = icon(Star);
export const SparkIcon = icon(Spark);
export const FlaskIcon = icon(Flask);
export const FaceSmileIcon = icon(Emoji);
export const FolderIcon = icon(Folder);
export const BellIcon = icon(Bell);
export const BellOffIcon = icon(BellOff);
export const BoldIcon = icon(Bold);
export const ItalicIcon = icon(Italic);
export const UnderlineIcon = icon(Underline);
export const StrikethroughIcon = icon(Strikethrough);
export const CodeIcon = icon(Code);
export const DribbbleIcon = icon(Dribbble);
export const FacebookIcon = icon(Facebook);
export const GithubIcon = icon(Github);
export const InstagramIcon = icon(Instagram);
export const LinkedinIcon = icon(Linkedin);
export const MediumIcon = icon(Medium);
export const PinterestIcon = icon(Pinterest);
export const SnapchatIcon = icon(Snapchat);
export const TelegramIcon = icon(Telegram);
export const ThreadsIcon = icon(Threads);
export const TiktokIcon = icon(Tiktok);
export const YoutubeIcon = icon(Youtube);
export const XPlatformIcon = icon(X);
